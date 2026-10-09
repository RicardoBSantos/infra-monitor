package br.com.inframonitor.security;
import jakarta.servlet.DispatcherType;
import org.springframework.boot.context.properties.EnableConfigurationProperties; import org.springframework.context.annotation.*; import org.springframework.http.HttpMethod; import org.springframework.security.config.Customizer; import org.springframework.security.config.annotation.web.builders.HttpSecurity; import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity; import org.springframework.security.config.http.SessionCreationPolicy; import org.springframework.security.core.userdetails.UserDetailsService; import org.springframework.security.core.userdetails.UsernameNotFoundException; import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder; import org.springframework.security.crypto.password.PasswordEncoder; import org.springframework.security.web.*; import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
@Configuration @EnableWebSecurity @EnableConfigurationProperties(JwtProperties.class)
public class SecurityConfiguration {
 @Bean PasswordEncoder passwordEncoder(){return new BCryptPasswordEncoder(12);}
 @Bean UserDetailsService userDetailsService(){return username->{throw new UsernameNotFoundException("Autenticacao por usuario e senha nao e utilizada");};}
 @Bean JwtAuthenticationFilter jwtAuthenticationFilter(JwtService jwt, br.com.inframonitor.usuario.repository.UsuarioRepository users, ApiAuthenticationEntryPoint entry, tools.jackson.databind.ObjectMapper mapper){return new JwtAuthenticationFilter(jwt,users,entry,mapper);}
 @Bean SecurityFilterChain securityFilterChain(HttpSecurity h,JwtAuthenticationFilter jwt,ApiAuthenticationEntryPoint unauth,ApiAccessDeniedHandler denied)throws Exception{return h.csrf(c->c.disable()).cors(Customizer.withDefaults()).sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.STATELESS)).exceptionHandling(e->e.authenticationEntryPoint(unauth).accessDeniedHandler(denied)).authorizeHttpRequests(a->a
  .dispatcherTypeMatchers(DispatcherType.ASYNC).permitAll()
  .requestMatchers(HttpMethod.POST,"/api/v1/auth/login").permitAll().requestMatchers(HttpMethod.GET,"/actuator/health").permitAll()
  .requestMatchers(HttpMethod.PUT,"/api/v1/usuarios/me/senha").authenticated().requestMatchers("/api/v1/usuarios/**").hasRole("ADMIN")
  .requestMatchers(HttpMethod.GET,"/api/v1/**").hasAnyRole("ADMIN","OPERADOR","VISUALIZADOR")
  .requestMatchers(HttpMethod.POST,"/api/v1/unidades/**","/api/v1/tipos-equipamento/**","/api/v1/equipamentos/**","/api/v1/monitores/**","/api/v1/medicoes/**").hasAnyRole("ADMIN","OPERADOR")
  .requestMatchers(HttpMethod.PUT,"/api/v1/unidades/**","/api/v1/tipos-equipamento/**","/api/v1/equipamentos/**","/api/v1/monitores/**").hasAnyRole("ADMIN","OPERADOR")
  .requestMatchers(HttpMethod.PATCH,"/api/v1/unidades/**","/api/v1/tipos-equipamento/**","/api/v1/equipamentos/**","/api/v1/monitores/**","/api/v1/incidentes/*/fechar","/api/v1/incidentes/*/reconhecer").hasAnyRole("ADMIN","OPERADOR")
  .requestMatchers(HttpMethod.DELETE,"/api/v1/unidades/**","/api/v1/tipos-equipamento/**","/api/v1/equipamentos/**","/api/v1/monitores/**").hasAnyRole("ADMIN","OPERADOR")
  .requestMatchers("/api/**").hasRole("ADMIN").anyRequest().denyAll()).addFilterBefore(jwt,UsernamePasswordAuthenticationFilter.class).build();}
}
