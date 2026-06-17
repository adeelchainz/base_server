import responseMessage from '../../../constant/responseMessage'
import parsers from '../../../utils/parsers'
import { ILoginRequest, IRegisterRequest } from './types/authentication.interface'
import dateAndTime from '../../../utils/date-and-time'
import { CustomError } from '../../../utils/errors'
import query from '../_shared/repo/user.repository'
import hashing from '../../../utils/hashing'
import code from '../../../utils/code'
import { IUser } from '../_shared/types/users.interface'
import { EUserRoles } from '../../../constant/users'
import emailService from '../../../services/email'
import logger from '../../../handlers/logger'
import validate from './validation/validations'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import jwt from '../../../utils/jwt'
import config from '../../../config/config'
import { IToken } from '../_shared/types/token.interface'
import tokenRepository from '../_shared/repo/token.repository'

dayjs.extend(utc)

export const registrationService = async (payload: IRegisterRequest) => {
    const { name, phoneNumber, email, password } = payload

    let phoneData = { isoCode: '', countryCode: '', internationalNumber: '' }
    let timezone = 'UTC'

    if (phoneNumber) {
        const normalizedPhone = phoneNumber.startsWith('+') ? phoneNumber : '+' + phoneNumber
        const parsed = parsers.parsePhoneNumber(normalizedPhone)
        if (!parsed.countryCode || !parsed.internationalNumber || !parsed.isoCode) {
            throw new CustomError(responseMessage.auth.INVALID_PHONE_NUMBER, 422)
        }
        const tz = dateAndTime.countryTimezone(parsed.isoCode)
        if (!tz || tz.length === 0) {
            throw new CustomError(responseMessage.auth.INVALID_PHONE_NUMBER, 422)
        }
        phoneData = { isoCode: parsed.isoCode, countryCode: parsed.countryCode, internationalNumber: parsed.internationalNumber }
        timezone = tz[0].name
    }

    //Validate if user already exists
    await validate.userAlreadyExistsViaEmail(email)

    //Encrypting password
    const hashedPassword = await hashing.hashPassword(password)

    //Account confirmation token and code generation
    const token = code.generateRandomId()
    const OTP = code.generateOTP(6)

    const userObj: IUser = {
        name,
        email,
        phoneNumber: phoneData,
        accountConfirmation: {
            status: true,
            token,
            code: OTP,
            timestamp: dayjs().utc().toDate()
        },
        passwordReset: {
            token: null,
            expiry: null,
            lastResetAt: null
        },
        lastLoginAt: null,
        role: EUserRoles.USER,
        timezone,
        password: hashedPassword,
        consent: true
    }

    //adding user to db
    const newUser = await query.createUser(userObj)

    return {
        success: true,
        _id: newUser._id
    }
}

// Kept for backwards-compatibility: existing unconfirmed accounts can still confirm via email link.
export const accountConfirmationService = async (token: string, code: string) => {
    const user = await query.findUserByConfirmationTokenAndCode(token, code)
    if (!user) {
        throw new CustomError(responseMessage.auth.USER_NOT_EXIST, 404)
    }

    //Check if account is already confirmed
    if (user.accountConfirmation.status) {
        throw new CustomError(responseMessage.auth.ALREADY_CONFIRMED('Account'), 400)
    }

    //if not, lets confirm
    user.accountConfirmation.status = true
    user.accountConfirmation.timestamp = dayjs().utc().toDate()

    await user.save()

    //Sending confirmation emails
    const to = [user.email]
    const subject = `Welcome to the base! `
    const text = `Account has been confirmed.`

    emailService.sendEmail(to, subject, text).catch((error) => {
        logger.error('Error sending email', {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            meta: error
        })
    })

    return {
        success: true,
        _id: user._id
    }
}

export const loginService = async (payload: ILoginRequest) => {
    const { email, password } = payload

    //Check if the user is registered
    const user = await query.findUserByEmail(email, '+password')
    if (!user) {
        throw new CustomError(responseMessage.NOT_FOUND('User'), 404)
    }

    //Validate password
    const isValidPassword = await hashing.comparePassword(password, user.password)
    if (!isValidPassword) {
        throw new CustomError(responseMessage.auth.INVALID_EMAIL_OR_PASSWORD, 400)
    }

    //Check if account is confirmed
    if (!user.accountConfirmation.status) {
        throw new CustomError(responseMessage.auth.ACCOUNT_NOT_CONFIRMED, 403)
    }

    //Genrate tokens
    const accessToken = jwt.generateToken({ userId: user._id }, config.TOKENS.ACCESS.SECRET, config.TOKENS.ACCESS.EXPIRY)
    const refreshToken = jwt.generateToken({ userId: user._id }, config.TOKENS.REFRESH.SECRET, config.TOKENS.REFRESH.EXPIRY)

    user.lastLoginAt = dayjs().utc().toDate()

    await user.save()

    //Storing refresh token into db
    const token: IToken = {
        token: refreshToken
    }
    await tokenRepository.createToken(token)

    const userObj = user.toObject()
    delete (userObj as unknown as Record<string, unknown>).password

    return {
        success: true,
        user: userObj,
        accessToken: accessToken,
        refreshToken: refreshToken
    }
}
