'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

export interface AuthUser {
    _id: string
    name: string
    email: string
}

interface AuthContextType {
    user: AuthUser | null
    loading: boolean
    login: (user: AuthUser) => void
    logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        apiFetch<AuthUser>('/v1/user/me')
            .then(res => setUser(res.data))
            .catch(() => setUser(null))
            .finally(() => setLoading(false))
    }, [])

    const login = (u: AuthUser) => setUser(u)

    const logout = () => {
        apiFetch('/v1/logout', { method: 'PUT' })
            .catch(() => {})
            .finally(() => {
                setUser(null)
                window.location.href = '/login'
            })
    }

    return (
        <AuthContext.Provider value={{ user, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth(): AuthContextType {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
    return ctx
}
