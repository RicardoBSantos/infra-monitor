"""Assemble approved CI outputs; never deploy."""
import argparse, hashlib, json, os, re, shutil, sys, time, urllib.request, zipfile
from pathlib import Path, PurePosixPath
SHA=re.compile(r"[0-9a-f]{40}")
DENIED={".env",".git","node_modules","runtime.properties","secrets","id_rsa"}
SECRET=re.compile(r"(?im)^\s*(?:password|secret|bot-token|DB_PASSWORD|JWT_SECRET|TELEGRAM_BOT_TOKEN)\s*[:=]\s*([^\r\n]+)")
def fail(message): raise ValueError(message)
def relative(name):
    if not isinstance(name,str) or "\\" in name or ":" in name: fail("Invalid relative path")
    p=PurePosixPath(name)
    if p.is_absolute() or not p.parts or ".." in p.parts or str(p)!=name: fail("Unexpected path")
    if any(x.lower() in DENIED or x.startswith(".") for x in p.parts): fail("Forbidden file")
    return p
def inventory(root):
    root=Path(root)
    if root.is_symlink(): fail("Symlink root")
    result={}
    for p in root.rglob("*"):
        if p.is_symlink(): fail("Symlink")
        if p.is_file():
            name=p.relative_to(root).as_posix(); relative(name)
            if name.casefold() in {n.casefold() for n in result}: fail("Case collision")
            result[name]=p
    return result
def digest(p):
    h=hashlib.sha256()
    with open(p,"rb") as f:
        for b in iter(lambda:f.read(1048576),b""): h.update(b)
    return h.hexdigest()
def load(path):
    with open(path,encoding="utf-8-sig") as f: return json.load(f)
def scan_text(data):
    for match in SECRET.finditer(data):
        value=match.group(1).strip().strip("'\"")
        if value and chr(36)+"{" not in value and value not in ("null","false"):
            fail("Known credential assignment; value withheld")
    if "-----BEGIN PRIVATE KEY-----" in data or re.search(r"\bgh[pousr]_[A-Za-z0-9]{20,}",data):
        fail("Known credential material; value withheld")
def validate_source(root,component,commit):
    if not SHA.fullmatch(commit): fail("Invalid commit")
    items=inventory(root); manifest=load(Path(root)/"build-manifest.json")
    if manifest.get("component")!=component or manifest.get("commit")!=commit: fail("Divergent commit/component")
    checks={}
    for line in (Path(root)/"SHA256SUMS").read_text().splitlines():
        match=re.fullmatch(r"([0-9a-f]{64})  (.+)",line)
        if not match: fail("Invalid SHA256SUMS")
        name=match[2]; relative(name)
        if name in checks: fail("Duplicate checksum")
        checks[name]=match[1]
    payload=set(items)-{"build-manifest.json","SHA256SUMS"}
    if payload!=set(checks): fail("Missing or unexpected payload")
    for name,expected in checks.items():
        if digest(items[name])!=expected: fail("SHA-256 mismatch")
    if component=="backend":
        expected=f"infra-monitor-backend-{commit}.jar"
        if payload!={expected} or manifest.get("sha256")!=checks[expected]: fail("Unexpected JAR identity")
        with zipfile.ZipFile(items[expected]) as z:
            names=z.namelist()
            for n in names:
                if not n.endswith("/"): relative(n)
            if not any(n.startswith("BOOT-INF/classes/") for n in names): fail("Not a Spring Boot JAR")
            if "META-INF/MANIFEST.MF" not in names: fail("Not executable")
            mf=z.read("META-INF/MANIFEST.MF").decode("utf-8")
            if "Main-Class: org.springframework.boot.loader.launch.JarLauncher" not in mf or "org/springframework/boot/loader/launch/JarLauncher.class" not in names:
                fail("Spring Boot launcher absent")
            if "BOOT-INF/classes/br/com/inframonitor/medicao/retencao/DetailedHistoryGuard.class" not in names:
                fail("V25 history protection absent")
            for n in names:
                if n.startswith("BOOT-INF/classes/") and n.endswith((".yml",".yaml",".properties",".json",".xml")):
                    scan_text(z.read(n).decode("utf-8",errors="replace"))
    elif component=="frontend":
        if manifest.get("configuration")!="production" or "wwwroot/index.html" not in payload: fail("Frontend incomplete")
        if any(not n.startswith("wwwroot/") for n in payload): fail("Unexpected frontend path")
        for name in payload:
            if name.endswith((".html",".js",".json",".txt")):
                scan_text(items[name].read_text(encoding="utf-8",errors="replace"))
    else: fail("Unknown component")
    return manifest
def assemble(backend,frontend,commit,output,templates,provenance=None):
    bm=validate_source(backend,"backend",commit); fm=validate_source(frontend,"frontend",commit)
    output=Path(output)
    if output.exists(): fail("Output must not exist")
    version="r-"+commit
    (output/"releases"/version/"backend").mkdir(parents=True)
    release=output/"releases"/version
    shutil.copy2(Path(backend)/f"infra-monitor-backend-{commit}.jar",release/"backend"/"app.jar")
    shutil.copytree(Path(frontend)/"wwwroot",release/"frontend")
    for name in ("ReleaseTools.psm1","Invoke-WindowsRelease.ps1","winsw.xml.template","web.config.template"):
        shutil.copy2(Path(templates)/name,output/name)
    shutil.copy2(Path(templates)/"web.config.template",release/"frontend"/"web.config")
    hashes={n:digest(p) for n,p in inventory(output).items()}
    manifest={"format":1,"version":version,"commit":commit,"schemaVersion":25,
              "historyGuard":True,"schemaCompatibilityProven":False,
              "components":{"backend":bm,"frontend":fm},"files":hashes,"provenance":provenance or {}}
    (output/"package-manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
    (output/"SHA256SUMS").write_text("".join(f"{digest(p)}  {n}\n" for n,p in sorted(inventory(output).items())),encoding="utf-8")
    return output
def api(repo,path):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+",repo): fail("Invalid repository")
    req=urllib.request.Request("https://api.github.com/repos/"+repo+"/"+path,
        headers={"Authorization":"Bearer "+os.environ["GH_TOKEN"],"Accept":"application/vnd.github+json"})
    with urllib.request.urlopen(req,timeout=30) as response: return json.load(response)
def resolve(repo,commit,output,attempts=40):
    if not SHA.fullmatch(commit): fail("Invalid commit")
    selected={}
    for workflow,component in (("ci-backend.yml","backend"),("ci-frontend.yml","frontend")):
        for retry in range(attempts):
            runs=api(repo,f"actions/workflows/{workflow}/runs?event=push&branch=main&head_sha={commit}&per_page=100")["workflow_runs"]
            valid=[r for r in runs if r["head_sha"]==commit and r["conclusion"]=="success"
                   and r["event"]=="push" and r["head_branch"]=="main"
                   and r["path"]==".github/workflows/"+workflow and r["head_repository"]["full_name"]==repo]
            if valid: break
            if retry==attempts-1: fail("Approved main CI unavailable")
            time.sleep(15)
        run=valid[0]; name=f"{component}-{commit}-{run['id']}-{run['run_attempt']}"
        artifacts=api(repo,f"actions/runs/{run['id']}/artifacts?per_page=100")["artifacts"]
        found=[a for a in artifacts if a["name"]==name and not a["expired"]]
        if len(found)!=1: fail("Approved artifact absent/ambiguous")
        selected[component]={"run":run["id"],"artifact":found[0]["id"],"name":name}
    Path(output).write_text(json.dumps(selected,indent=2)+"\n",encoding="utf-8")
    with open(os.environ["GITHUB_OUTPUT"],"a",encoding="utf-8") as f:
        for component,m in selected.items(): f.write(f"{component}_run={m['run']}\n{component}_artifact={m['artifact']}\n")
if __name__=="__main__":
    parser=argparse.ArgumentParser(); sub=parser.add_subparsers(dest="command",required=True)
    r=sub.add_parser("resolve")
    for name in ("repo","commit","output"): r.add_argument("--"+name,required=True)
    a=sub.add_parser("assemble")
    for name in ("backend","frontend","commit","output","templates","provenance"): a.add_argument("--"+name,required=True)
    args=parser.parse_args()
    try:
        if args.command=="resolve": resolve(args.repo,args.commit,args.output)
        else: assemble(args.backend,args.frontend,args.commit,args.output,args.templates,load(args.provenance))
    except Exception as ex:
        print("Packaging failed: "+type(ex).__name__+": "+str(ex),file=sys.stderr); sys.exit(1)
