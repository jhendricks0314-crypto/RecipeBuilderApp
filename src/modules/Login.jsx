import { useAuth } from '../lib/auth.jsx'
import { IconGoogle, IconRain } from '../components/icons.jsx'

export default function Login() {
  const { login } = useAuth()
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--saffron)', marginBottom: 10 }}>
          <IconRain />
        </div>
        <h1><span className="dot">RAI</span>ning Recipes</h1>
        <p style={{ fontSize: 17, margin: '10px 0 28px' }}>
          Plan meals with AI, build smart shopping lists, and turn your receipts
          into real prices. Cook well, spend smart.
        </p>
        <button className="google-btn" onClick={login}>
          <IconGoogle /> Continue with Google
        </button>
        <p style={{ fontSize: 12.5, marginTop: 22, color: '#8ea091' }}>
          You'll sign in with Gmail and set up a profile with your cell number so
          you can share recipes with contacts.
        </p>
      </div>
    </div>
  )
}
