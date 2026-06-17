'use client'

import { useState, useEffect } from 'react'
import { useAuth, AuthUser } from '@/context/auth'
import { apiFetch } from '@/lib/api'

type Tab = 'signin' | 'signup'

export default function LoginPage() {
    const { login, user, loading: authLoading } = useAuth()
    const [tab, setTab] = useState<Tab>('signin')

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')

    const [signupName, setSignupName] = useState('')
    const [signupEmail, setSignupEmail] = useState('')
    const [signupPassword, setSignupPassword] = useState('')
    const [signupConfirm, setSignupConfirm] = useState('')

    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!authLoading && user) window.location.replace('/exam')
    }, [user, authLoading])

    async function handleSignIn(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        setLoading(true)
        try {
            await apiFetch('/v1/login', { method: 'POST', body: JSON.stringify({ email, password }) })
            const me = await apiFetch<AuthUser>('/v1/user/me')
            login(me.data)
        } catch (err) {
            const e = err as Error & { status?: number }
            setError(e.status === 400 || e.status === 404 || e.status === 403 ? 'Invalid email or password' : (e.message ?? 'Sign in failed'))
        } finally {
            setLoading(false)
        }
    }

    async function handleSignUp(e: React.FormEvent) {
        e.preventDefault()
        if (signupPassword !== signupConfirm) {
            setError('Passwords do not match')
            return
        }
        setError(null)
        setLoading(true)
        try {
            await apiFetch('/v1/register', {
                method: 'POST',
                body: JSON.stringify({ name: signupName, email: signupEmail, password: signupPassword, consent: true })
            })
            await apiFetch('/v1/login', { method: 'POST', body: JSON.stringify({ email: signupEmail, password: signupPassword }) })
            const me = await apiFetch<AuthUser>('/v1/user/me')
            login(me.data)
        } catch (err) {
            const e = err as Error & { status?: number }
            setError(e.status === 409 ? 'An account with that email already exists' : (e.message ?? 'Sign up failed'))
        } finally {
            setLoading(false)
        }
    }

    const inputCls = 'bg-[#0f0e17] border border-[#2a2a4a] rounded px-3 py-2 text-[#e0e0e0] focus:outline-none focus:border-[#4cc9f0]'

    return (
        <div className="flex items-center justify-center min-h-[80vh]">
            <div className="bg-[#16213e] rounded-lg p-8 w-full max-w-sm flex flex-col gap-4">
                <div className="flex border-b border-[#2a2a4a] mb-2">
                    {(['signin', 'signup'] as Tab[]).map(t => (
                        <button
                            key={t}
                            onClick={() => { setTab(t); setError(null) }}
                            className={[
                                'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                                tab === t ? 'border-[#4cc9f0] text-[#4cc9f0]' : 'border-transparent text-[#555] hover:text-[#aaa]'
                            ].join(' ')}
                        >
                            {t === 'signin' ? 'Sign In' : 'Sign Up'}
                        </button>
                    ))}
                </div>

                {tab === 'signin' ? (
                    <form onSubmit={handleSignIn} className="flex flex-col gap-3">
                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-[#aaa]">Email</span>
                            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className={inputCls} />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-[#aaa]">Password</span>
                            <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className={inputCls} />
                        </label>
                        {error && <p className="text-sm text-[#e94560]">{error}</p>}
                        <button type="submit" disabled={loading}
                            className="bg-[#4cc9f0] text-[#0f0e17] font-semibold py-2 rounded transition-opacity disabled:opacity-40">
                            {loading ? 'Signing in…' : 'Sign In'}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleSignUp} className="flex flex-col gap-3">
                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-[#aaa]">Name</span>
                            <input type="text" required minLength={2} value={signupName} onChange={e => setSignupName(e.target.value)} className={inputCls} />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-[#aaa]">Email</span>
                            <input type="email" required value={signupEmail} onChange={e => setSignupEmail(e.target.value)} className={inputCls} />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-[#aaa]">Password</span>
                            <input type="password" required value={signupPassword} onChange={e => setSignupPassword(e.target.value)} className={inputCls} />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-[#aaa]">Confirm Password</span>
                            <input type="password" required value={signupConfirm} onChange={e => setSignupConfirm(e.target.value)} className={inputCls} />
                        </label>
                        {error && <p className="text-sm text-[#e94560]">{error}</p>}
                        <button type="submit" disabled={loading}
                            className="bg-[#4cc9f0] text-[#0f0e17] font-semibold py-2 rounded transition-opacity disabled:opacity-40">
                            {loading ? 'Creating account…' : 'Create Account'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    )
}
