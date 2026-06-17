'use client'

import Link from 'next/link'
import { useAuth } from '@/context/auth'

export default function ClientNav() {
    const { user, loading, logout } = useAuth()

    return (
        <nav className="border-b border-[#2a2a4a] px-6 py-3 flex items-center gap-6">
            <Link href={user ? '/exam' : '/login'} className="text-[#4cc9f0] font-bold hover:opacity-80 transition-opacity">
                ✦ Homework Grader
            </Link>

            {!loading && user && (
                <>
                    <Link href="/exam" className="text-sm text-[#e0e0e0] hover:text-[#4cc9f0] transition-colors">
                        Grade
                    </Link>
                    <Link href="/results" className="text-sm text-[#e0e0e0] hover:text-[#4cc9f0] transition-colors">
                        Results
                    </Link>
                    <span className="ml-auto text-sm text-[#aaa]">{user.name}</span>
                    <button
                        onClick={logout}
                        className="text-sm text-[#e94560] hover:underline"
                    >
                        Logout
                    </button>
                </>
            )}

            {!loading && !user && (
                <Link href="/login" className="ml-auto text-sm text-[#4cc9f0] hover:underline">
                    Sign In
                </Link>
            )}
        </nav>
    )
}
