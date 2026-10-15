import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { IconLogo } from "../components/Icons";

const MENSAJES = {
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/wrong-password": "Correo o contraseña incorrectos.",
  "auth/user-not-found": "Ese correo no está dado de alta. Pídele acceso al administrador.",
  "auth/user-disabled": "Tu acceso está desactivado. Habla con el administrador.",
  "auth/too-many-requests": "Demasiados intentos. Espera unos minutos.",
  "auth/invalid-email": "Ese correo no es válido.",
};

export default function Login() {
  const { user, perfil, loading, signIn, signInEmail, enviarCorreoContrasena, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);

  if (loading) return <div className="center-page">Cargando...</div>;
  if (user && perfil) return <Navigate to={perfil.rol === "admin" ? "/" : "/rh/publicaciones"} replace />;

  const handleSignIn = async () => {
    setError(null);
    try {
      await signIn();
    } catch (err) {
      // auth/popup-closed-by-user / auth/cancelled-popup-request just mean
      // the user dismissed it -- not worth showing as an error.
      if (err?.code !== "auth/popup-closed-by-user" && err?.code !== "auth/cancelled-popup-request") {
        setError("No se pudo iniciar sesión. Intenta de nuevo.");
      }
    }
  };

  const entrarConCorreo = async (e) => {
    e.preventDefault();
    setError(null);
    setAviso(null);
    setEnviando(true);
    try {
      await signInEmail(email, password);
    } catch (err) {
      setError(MENSAJES[err?.code] || "No se pudo iniciar sesión. Intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  };

  const crearContrasena = async () => {
    setError(null);
    setAviso(null);
    if (!email.trim()) return setError("Escribe tu correo arriba y vuelve a dar clic.");
    try {
      await enviarCorreoContrasena(email);
      setAviso(`Si ${email.trim()} está dado de alta en el panel, te llegará un correo para crear tu contraseña (revisa también "correo no deseado"). Si no te llega en unos minutos, pídele al administrador que te dé de alta en Usuarios.`);
    } catch (err) {
      setError(MENSAJES[err?.code] || "No se pudo enviar el correo. Intenta de nuevo.");
    }
  };

  return (
    <div className="center-page login-page">
      <div className="login-card">
        <span className="brand-logo login-logo" aria-hidden="true">
          <IconLogo width={26} height={26} />
        </span>
        <h1>CaptaVision</h1>
        <p>Panel de las pantallas de las sucursales.</p>

        {user && perfil === null ? (
          <>
            <p className="error-banner">
              La cuenta {user.email} no tiene acceso al panel. Pídele al administrador que te dé de alta.
            </p>
            <button className="btn btn-ghost" onClick={signOut}>Usar otra cuenta</button>
          </>
        ) : (
          <>
            <form className="login-form" onSubmit={entrarConCorreo}>
              <input className="input" type="email" autoComplete="username" placeholder="Correo"
                value={email} onChange={(e) => setEmail(e.target.value)} required />
              <input className="input" type="password" autoComplete="current-password" placeholder="Contraseña"
                value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button className="btn btn-primary" type="submit" disabled={enviando}>
                {enviando ? "Entrando..." : "Entrar"}
              </button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={crearContrasena}>
                Primera vez u olvidé mi contraseña
              </button>
            </form>
            <div className="login-separador"><span>o</span></div>
            <button className="btn" onClick={handleSignIn}>
              Entrar con Google
            </button>
          </>
        )}
        {error && <p className="error-banner">{error}</p>}
        {aviso && <p className="panel success-panel">{aviso}</p>}
        <p className="hint">Solo pueden entrar los correos que el administrador dio de alta en Usuarios. Si eres nuevo, pídele primero que te dé de alta; después usa "Primera vez".</p>
      </div>
    </div>
  );
}
