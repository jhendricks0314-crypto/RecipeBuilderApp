import { useAuth } from '../lib/auth.jsx'
import { IconGoogle } from '../components/icons.jsx'
import BrandMark from '../components/Brand.jsx'

export default function Login() {
  const { login } = useAuth()
  return (
    <div className="login-wrap">
      <div className="login-card">
        {/* The badge is drawn for a dark field, so it sits straight on the screen. */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
          <BrandMark size={200} />
        </div>
        <p style={{ fontSize: 17, margin: '10px 0 28px' }}>
          Plan meals with AI, build smart shopping lists, and turn your receipts
          into real prices. Cook well, spend smart.
        </p>
        <button className="google-btn" onClick={login}>
          <IconGoogle /> Continue with Google
        </button>
        <p style={{ fontSize: 12.5, marginTop: 22, color: '#8ea091' }}>
          Sign in with Google to set up your kitchen. Everything you save — recipes,
          pantry, prices — lives there.
        </p>
      </div>
    </div>
  )
}
