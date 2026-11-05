import importlib.util, json, tempfile, unittest, zipfile
from pathlib import Path
SPEC=importlib.util.spec_from_file_location("packaging_impl",Path(__file__).parents[1]/"package.py")
p=importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(p)
COMMIT="a"*40
def fixture(base):
    b=base/"backend"; w=base/"frontend"; b.mkdir(); (w/"wwwroot").mkdir(parents=True)
    jar=b/f"infra-monitor-backend-{COMMIT}.jar"
    with zipfile.ZipFile(jar,"w") as z:
        z.writestr("META-INF/MANIFEST.MF","Main-Class: org.springframework.boot.loader.launch.JarLauncher\n")
        z.writestr("BOOT-INF/classes/br/com/inframonitor/medicao/retencao/DetailedHistoryGuard.class",b"fixture-not-executable")
        z.writestr("org/springframework/boot/loader/launch/JarLauncher.class",b"fixture-not-executable")
    (w/"wwwroot/index.html").write_text("<html>fixture</html>")
    for root,component in ((b,"backend"),(w,"frontend")):
        files=p.inventory(root)
        sums={name:p.digest(file) for name,file in files.items()}
        (root/"SHA256SUMS").write_text("".join(f"{h}  {name}\n" for name,h in sums.items()))
        meta={"component":component,"commit":COMMIT,"run_id":"fixture"}
        if component=="backend": meta["sha256"]=p.digest(jar)
        else: meta["configuration"]="production"
        (root/"build-manifest.json").write_text(json.dumps(meta))
    return b,w
class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
        self.b,self.w=fixture(self.root)
    def tearDown(self): self.temp.cleanup()
    def validate(self): return p.validate_source(self.b,"backend",COMMIT)
    def test_valid_sha256(self): self.assertEqual(self.validate()["commit"],COMMIT)
    def test_tampered_payload(self):
        next(self.b.glob("*.jar")).write_bytes(b"tampered")
        with self.assertRaises(ValueError): self.validate()
    def test_divergent_commits(self):
        with self.assertRaises(ValueError): p.validate_source(self.w,"frontend","b"*40)
    def test_missing_index(self):
        (self.w/"wwwroot/index.html").unlink()
        with self.assertRaises(ValueError): p.validate_source(self.w,"frontend",COMMIT)
    def test_missing_jar(self):
        next(self.b.glob("*.jar")).unlink()
        with self.assertRaises(ValueError): self.validate()
    def test_invalid_manifest(self):
        (self.b/"build-manifest.json").write_text("null")
        with self.assertRaises((ValueError,AttributeError)): self.validate()
    def test_missing_manifest(self):
        (self.b/"build-manifest.json").unlink()
        with self.assertRaises(FileNotFoundError): self.validate()
    def test_unexpected_file(self):
        (self.b/"extra.txt").write_text("unexpected")
        with self.assertRaises(ValueError): self.validate()
    def test_unexpected_name(self):
        next(self.b.glob("*.jar")).rename(self.b/"wrong.jar")
        with self.assertRaises(ValueError): self.validate()
    def test_traversal(self):
        for name in ("../x","C:/x","x\\y","/x","a/./b","a//b"):
            with self.subTest(name=name), self.assertRaises(ValueError): p.relative(name)
    def test_secret_files(self):
        for name in (".env","secrets/DB_PASSWORD","x/.git/config"):
            with self.subTest(name=name),self.assertRaises(ValueError): p.relative(name)
    def test_secret_assignment(self):
        with self.assertRaises(ValueError): p.scan_text("JWT_SECRET=synthetic-test-value")
    def test_assembly_version(self):
        out=p.assemble(self.b,self.w,COMMIT,self.root/"out",Path(__file__).parents[1])
        meta=p.load(out/"package-manifest.json")
        self.assertEqual(meta["version"],"r-"+COMMIT)
        self.assertFalse(meta["schemaCompatibilityProven"])
        self.assertTrue((out/"releases"/("r-"+COMMIT)/"frontend/index.html").is_file())
    def test_output_must_be_new(self):
        with self.assertRaises(ValueError): p.assemble(self.b,self.w,COMMIT,self.root,Path(__file__).parents[1])
if __name__=="__main__":
    import sys
    if len(sys.argv)==3 and sys.argv[1]=="--fixture":
        root=Path(sys.argv[2]); root.mkdir()
        b,w=fixture(root)
        p.assemble(b,w,COMMIT,root/"package",Path(__file__).parents[1])
    else: unittest.main()
