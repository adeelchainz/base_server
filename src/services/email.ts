import { Resend } from 'resend'
import config from '../config/config'

const resend = new Resend(config.EMAIL_API_KEY)

export default {
    sendEmail: async (to: string[], subject: string, text: string) => {
        try {
            await resend.emails.send({
                from: `Coderatory <onboarding@resend.dev>`,
                to,
                subject,
                text
            })
        } catch (error) {
            throw error
        }
    }
}
