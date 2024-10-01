import responseMessage from '../../../constant/responseMessage'
import parsers from '../../../utils/parsers'
import { IRegisterRequest } from './types/authentication.interface'
import dateAndTime from '../../../utils/date-and-time'
import { CustomError } from '../../../utils/errors'
import query from '../_shared/repo/user.repository'
import hashing from '../../../utils/hashing'
import code from '../../../utils/code'
import { IUser } from '../_shared/types/users.interface'
import { EUserRoles } from '../../../constant/users'
import emailService from '../../../services/email'
import logger from '../../../handlers/logger'

export const registrationService = async (payload: IRegisterRequest) => {
    const { name, phoneNumber, email, password } = payload

    // Parsing and validating phone number
    const { countryCode, internationalNumber, isoCode } = parsers.parsePhoneNumber('+' + phoneNumber)
    if (!countryCode || !internationalNumber || !isoCode) {
        throw new CustomError(responseMessage.auth.INVALID_PHONE_NUMBER, 422)
    }

    // Extracting country timezone
    const timezone = dateAndTime.countryTimezone(isoCode)
    if (!timezone || timezone.length === 0) {
        throw new CustomError(responseMessage.auth.INVALID_PHONE_NUMBER, 422)
    }

    //Check if user already exists
    const user = await query.findUserByEmail(email)
    if (user) {
        throw new CustomError(responseMessage.auth.ALREADY_EXISTS('user', email), 422)
    }

    //Encrypting password
    const hashedPassword = await hashing.hashPassword(password)

    //Account confimation token and code generation
    const token = code.generateRandomId()
    const OTP = code.generateOTP(6)

    const userObj: IUser = {
        name,
        email,
        phoneNumber: {
            countryCode,
            isoCode,
            internationalNumber
        },
        accountConfimation: {
            status: false,
            token,
            code: OTP,
            timestamp: null
        },
        passwordReset: {
            token: null,
            expiry: null,
            lastResetAt: null
        },
        lastLoginAt: null,
        role: EUserRoles.USER,
        timezone: timezone[0].name,
        password: hashedPassword,
        consent: true
    }

    //adding user to db
    const newUser = await query.createUser(userObj)

    //Sending confimation emails
    const confimationURL = `Frontendhost/confimation/${token}?code=${OTP}`
    const to = [email]
    const subject = `Confirm your account`
    const text = `Hey ${name}, Please confirm your account by clicking the link belown\n\n${confimationURL}`

    emailService.sendEmail(to, subject, text).catch((error) => {
        logger.error('Error sending email', {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            meta: error
        })
    })

    return {
        success: true,
        _id: newUser._id
    }
}