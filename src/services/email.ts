import { Resend } from 'resend'
import config from '../config/config'
import logger from '../handlers/logger'

const resend = config.EMAIL_API_KEY ? new Resend(config.EMAIL_API_KEY) : null

if (!resend) {
    logger.warn('EMAIL_SERVICE_API_KEY is not set — email sending is disabled')
}

export default {
    sendEmail: async (to: string[], subject: string, text: string) => {
        if (!resend) {
            logger.warn('sendEmail called but Resend is not configured', { meta: { to, subject } })
            return
        }
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
