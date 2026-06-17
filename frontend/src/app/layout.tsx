import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '@/context/auth'
import ClientNav from '@/components/ClientNav'

export const metadata: Metadata = {
    title: 'Homework Grader',
    description: 'Handwritten exam grading'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className="bg-[#1a1a2e] text-[#e0e0e0] min-h-screen font-mono">
                <AuthProvider>
                    <ClientNav />
                    {children}
                </AuthProvider>
            </body>
        </html>
    )
}
