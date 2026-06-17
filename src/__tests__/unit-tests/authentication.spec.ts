import { accountConfirmationService, loginService, registrationService } from '../../APIs/user/authentication/authentication.service'
import query from '../../APIs/user/_shared/repo/user.repository'
import validate from '../../APIs/user/authentication/validation/validations'
import emailService from '../../services/email'
import { CustomError } from '../../utils/errors'
import parsers from '../../utils/parsers'
import responseMessage from '../../constant/responseMessage'
import dateAndTime from '../../utils/date-and-time'
import code from '../../utils/code'
import hashing from '../../utils/hashing'
import { IRegisterRequest } from '../../APIs/user/authentication/types/authentication.interface'
import jwt from '../../utils/jwt'
import tokenRepository from '../../APIs/user/_shared/repo/token.repository'

jest.mock('../../APIs/user/_shared/repo/user.repository')
jest.mock('../../services/email', () => ({
    sendEmail: jest.fn().mockResolvedValue(undefined)
}))

process.env.ACCESS_TOKEN_SECRET = 'access-secret'
process.env.REFRESH_TOKEN_SECRET = 'refresh-secret'

jest.mock('../../utils/parsers')
jest.mock('../../utils/date-and-time')
jest.mock('../../APIs/user/authentication/validation/validations')
jest.mock('../../utils/hashing')
jest.mock('../../utils/code')
jest.mock('../../utils/jwt')
jest.mock('../../APIs/user/_shared/repo/token.repository')

describe('registrationService', () => {
    const payloadWithPhone: IRegisterRequest = {
        name: 'John Doe',
        phoneNumber: '1234567890',
        email: 'john@example.com',
        password: 'securepassword',
        consent: true
    }

    const payloadNoPhone: IRegisterRequest = {
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'securepassword',
        consent: true
    }

    afterEach(() => jest.clearAllMocks())

    it('throws 422 when provided phoneNumber fails parsing', async () => {
        ;(parsers.parsePhoneNumber as jest.Mock).mockReturnValue({ countryCode: null, internationalNumber: null, isoCode: null })
        await expect(registrationService(payloadWithPhone)).rejects.toThrow(new CustomError(responseMessage.auth.INVALID_PHONE_NUMBER, 422))
    })

    it('throws 422 when provided phoneNumber has no matching timezone', async () => {
        ;(parsers.parsePhoneNumber as jest.Mock).mockReturnValue({ countryCode: 'US', internationalNumber: '1234567890', isoCode: 'US' })
        ;(dateAndTime.countryTimezone as jest.Mock).mockReturnValue([])
        await expect(registrationService(payloadWithPhone)).rejects.toThrow(new CustomError(responseMessage.auth.INVALID_PHONE_NUMBER, 422))
    })

    it('throws when email already exists', async () => {
        ;(validate.userAlreadyExistsViaEmail as jest.Mock).mockRejectedValue(
            new CustomError(responseMessage.auth.ALREADY_EXISTS(payloadNoPhone.email, 'User'), 409)
        )
        await expect(registrationService(payloadNoPhone)).rejects.toThrow('User already exists')
    })

    it('registers without phoneNumber — account is auto-confirmed, no email sent', async () => {
        ;(validate.userAlreadyExistsViaEmail as jest.Mock).mockResolvedValue(undefined)
        ;(hashing.hashPassword as jest.Mock).mockResolvedValue('hashedpassword')
        ;(code.generateRandomId as jest.Mock).mockReturnValue('randomToken')
        ;(code.generateOTP as jest.Mock).mockReturnValue('123456')
        ;(query.createUser as jest.Mock).mockResolvedValue({ _id: 'newUserId' })

        const response = await registrationService(payloadNoPhone)

        expect(response).toEqual({ success: true, _id: 'newUserId' })
        expect(emailService.sendEmail).not.toHaveBeenCalled()
        const createdCalls = (query.createUser as jest.Mock).mock.calls as [Record<string, unknown>][]
        const created = createdCalls[0][0]
        expect((created.accountConfirmation as { status: boolean }).status).toBe(true)
        expect(created.timezone).toBe('UTC')
    })

    it('registers with phoneNumber — account is auto-confirmed, no email sent', async () => {
        ;(parsers.parsePhoneNumber as jest.Mock).mockReturnValue({ countryCode: 'US', internationalNumber: '1234567890', isoCode: 'US' })
        ;(dateAndTime.countryTimezone as jest.Mock).mockReturnValue([{ name: 'America/New_York' }])
        ;(validate.userAlreadyExistsViaEmail as jest.Mock).mockResolvedValue(undefined)
        ;(hashing.hashPassword as jest.Mock).mockResolvedValue('hashedpassword')
        ;(code.generateRandomId as jest.Mock).mockReturnValue('randomToken')
        ;(code.generateOTP as jest.Mock).mockReturnValue('123456')
        ;(query.createUser as jest.Mock).mockResolvedValue({ _id: 'newUserId' })

        const response = await registrationService(payloadWithPhone)

        expect(response).toEqual({ success: true, _id: 'newUserId' })
        expect(emailService.sendEmail).not.toHaveBeenCalled()
        const createdCalls2 = (query.createUser as jest.Mock).mock.calls as [Record<string, unknown>][]
        const created2 = createdCalls2[0][0]
        expect((created2.accountConfirmation as { status: boolean }).status).toBe(true)
        expect(created2.timezone).toBe('America/New_York')
    })
})

describe('loginService', () => {
    const mockPayload = { email: 'john@example.com', password: 'securepassword' }

    afterEach(() => jest.clearAllMocks())

    it('throws 404 if user does not exist', async () => {
        ;(query.findUserByEmail as jest.Mock).mockResolvedValue(null)
        await expect(loginService(mockPayload)).rejects.toThrow(new CustomError(responseMessage.NOT_FOUND('User'), 404))
    })

    it('throws 400 if password is invalid', async () => {
        ;(query.findUserByEmail as jest.Mock).mockResolvedValue({ _id: 'userId', password: 'hashedPassword' })
        ;(hashing.comparePassword as jest.Mock).mockResolvedValue(false)
        await expect(loginService(mockPayload)).rejects.toThrow(new CustomError(responseMessage.auth.INVALID_EMAIL_OR_PASSWORD, 400))
    })

    it('returns tokens on successful login', async () => {
        const mockUserData = { _id: 'userId', accountConfirmation: { status: true } }
        const mockUser = { ...mockUserData, password: 'hashedPassword', save: jest.fn(), toObject: jest.fn().mockReturnValue(mockUserData) }
        ;(query.findUserByEmail as jest.Mock).mockResolvedValue(mockUser)
        ;(hashing.comparePassword as jest.Mock).mockResolvedValue(true)
        ;(jwt.generateToken as jest.Mock).mockImplementation(() => 'mockDefaultToken')
        ;(tokenRepository.createToken as jest.Mock).mockResolvedValue(undefined)

        const response = await loginService(mockPayload)

        expect(response).toEqual({ success: true, user: mockUserData, accessToken: 'mockDefaultToken', refreshToken: 'mockDefaultToken' })
        expect(mockUser.save).toHaveBeenCalled()
    })
})

describe('accountConfirmationService', () => {
    const mockSave = jest.fn()
    const mockUser = {
        _id: '12345',
        email: 'test@example.com',
        accountConfirmation: { status: false, timestamp: null },
        save: mockSave
    }

    afterEach(() => jest.clearAllMocks())

    it('throws 404 if user does not exist', async () => {
        ;(query.findUserByConfirmationTokenAndCode as jest.Mock).mockResolvedValue(null)
        await expect(accountConfirmationService('token', 'code')).rejects.toThrow(new CustomError('Account does not exist', 404))
    })

    it('throws 400 if account is already confirmed', async () => {
        ;(query.findUserByConfirmationTokenAndCode as jest.Mock).mockResolvedValue({ ...mockUser, accountConfirmation: { status: true } })
        await expect(accountConfirmationService('token', 'code')).rejects.toThrow(new CustomError('Account already CONFIRMED', 400))
    })

    it('confirms the account and sends a welcome email', async () => {
        ;(query.findUserByConfirmationTokenAndCode as jest.Mock).mockResolvedValue(mockUser)
        await accountConfirmationService('token', 'code')
        expect(mockUser.accountConfirmation.status).toBe(true)
        expect(mockSave).toHaveBeenCalledTimes(1)
        expect(emailService.sendEmail).toHaveBeenCalledWith([mockUser.email], 'Welcome to the base! ', 'Account has been confirmed.')
    })
})
