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
    sendEmail: jest.fn().mockResolvedValue(undefined) // Mocking as a resolved promise
}))

process.env.ACCESS_TOKEN_SECRET = 'access-secret'
process.env.REFRESH_TOKEN_SECRET = 'refresh-secret'

jest.mock('../../utils/parsers')
jest.mock('../../utils/date-and-time')
jest.mock('../../APIs/user/authentication/validation/validations')
jest.mock('../../utils/hashing')
jest.mock('../../utils/code')

jest.mock('../../utils/jwt') // Mock the jwt module
jest.mock('../../APIs/user/_shared/repo/token.repository') // Mock the tokenRepository module

describe('registrationService', () => {
    const mockPayload: IRegisterRequest = {
        name: 'John Doe',
        phoneNumber: '1234567890',
        email: 'john.doe@example.com',
        password: 'securepassword',
        consent: true
    }

    afterEach(() => {
        jest.clearAllMocks()
    })

    it('should throw an error if phone number is invalid', async () => {
        ;(parsers.parsePhoneNumber as jest.Mock).mockReturnValue({ countryCode: null, internationalNumber: null, isoCode: null })

        await expect(registrationService(mockPayload)).rejects.toThrow(new CustomError(responseMessage.auth.INVALID_PHONE_NUMBER, 422))
    })

    it('should throw an error if timezone is invalid', async () => {
        ;(parsers.parsePhoneNumber as jest.Mock).mockReturnValue({ countryCode: 'US', internationalNumber: '1234567890', isoCode: 'US' })
        ;(dateAndTime.countryTimezone as jest.Mock).mockReturnValue([])

        await expect(registrationService(mockPayload)).rejects.toThrow(new CustomError(responseMessage.auth.INVALID_PHONE_NUMBER, 422))
    })

    it('should validate if user already exists via email', async () => {
        ;(parsers.parsePhoneNumber as jest.Mock).mockReturnValue({ countryCode: 'US', internationalNumber: '1234567890', isoCode: 'US' })
        ;(dateAndTime.countryTimezone as jest.Mock).mockReturnValue([{ name: 'America/New_York' }])
        ;(validate.userAlreadyExistsViaEmail as jest.Mock).mockRejectedValue(
            new CustomError(responseMessage.auth.ALREADY_EXISTS(mockPayload.email, 'User'), 422)
        )

        await expect(registrationService(mockPayload)).rejects.toThrow('User already exists')
    })

    it('should successfully register a user and send a confirmation email', async () => {
        ;(parsers.parsePhoneNumber as jest.Mock).mockReturnValue({ countryCode: 'US', internationalNumber: '1234567890', isoCode: 'US' })
        ;(dateAndTime.countryTimezone as jest.Mock).mockReturnValue([{ name: 'America/New_York' }])
        ;(validate.userAlreadyExistsViaEmail as jest.Mock).mockResolvedValue(undefined)
        ;(hashing.hashPassword as jest.Mock).mockResolvedValue('hashedpassword')
        ;(code.generateRandomId as jest.Mock).mockReturnValue('randomToken')
        ;(code.generateOTP as jest.Mock).mockReturnValue('123456')
        ;(query.createUser as jest.Mock).mockResolvedValue({ _id: 'newUserId' })

        const response = await registrationService(mockPayload)

        expect(response).toEqual({ success: true, _id: 'newUserId' })
        expect(emailService.sendEmail).toHaveBeenCalledWith(
            [mockPayload.email],
            'Confirm your account',
            expect.stringContaining(`Hey ${mockPayload.name}, Please confirm your account by clicking the link below`)
        )
    })
})

describe('loginService', () => {
    const mockPayload = {
        email: 'john.doe@example.com',
        password: 'securepassword'
    }

    afterEach(() => {
        jest.clearAllMocks()
    })

    it('should throw an error if user does not exist', async () => {
        ;(query.findUserByEmail as jest.Mock).mockResolvedValue(null)

        await expect(loginService(mockPayload)).rejects.toThrow(new CustomError(responseMessage.NOT_FOUND('User'), 404))
    })

    it('should throw an error if password is invalid', async () => {
        const mockUser = { _id: 'userId', password: 'hashedPassword' }
        ;(query.findUserByEmail as jest.Mock).mockResolvedValue(mockUser)
        ;(hashing.comparePassword as jest.Mock).mockResolvedValue(false)

        await expect(loginService(mockPayload)).rejects.toThrow(new CustomError(responseMessage.auth.INVALID_EMAIL_OR_PASSWORD, 400))
    })

    it('should successfully log in a user and return tokens', async () => {
        const mockUser = { _id: 'userId', password: 'hashedPassword', save: jest.fn() }
        ;(query.findUserByEmail as jest.Mock).mockResolvedValue(mockUser)
        ;(hashing.comparePassword as jest.Mock).mockResolvedValue(true)
        ;(jwt.generateToken as jest.Mock).mockImplementation(() => {
            return 'mockDefaultToken'
        })

        // Generate the tokens
        ;(tokenRepository.createToken as jest.Mock).mockResolvedValue(undefined)

        const response = await loginService(mockPayload)

        expect(response).toEqual({
            success: true,
            user: mockUser,
            accessToken: 'mockDefaultToken',
            refreshToken: 'mockDefaultToken'
        })
        expect(mockUser.save).toHaveBeenCalled() // Ensure user.save() is called
        expect(tokenRepository.createToken).toHaveBeenCalledWith({ token: 'mockDefaultToken' })
    })
})

describe('accountConfirmationService', () => {
    const mockSave = jest.fn()
    const mockUser = {
        _id: '12345',
        email: 'test@example.com',
        accountConfimation: {
            status: false,
            timestamp: null
        },
        save: mockSave
    }

    afterEach(() => {
        jest.clearAllMocks()
    })

    it('should throw an error if user does not exist', async () => {
        ;(query.findUserByConfirmationTokenAndCode as jest.Mock).mockResolvedValue(null)

        await expect(accountConfirmationService('token', 'code')).rejects.toThrow(new CustomError('Account does not exist', 404))
    })

    it('should throw an error if account is already confirmed', async () => {
        ;(query.findUserByConfirmationTokenAndCode as jest.Mock).mockResolvedValue({
            ...mockUser,
            accountConfimation: { status: true }
        })

        await expect(accountConfirmationService('token', 'code')).rejects.toThrow(new CustomError('Account already CONFIRMED', 400))
    })

    it('should confirm the account and send an email', async () => {
        ;(query.findUserByConfirmationTokenAndCode as jest.Mock).mockResolvedValue(mockUser)
        await accountConfirmationService('token', 'code')

        expect(mockUser.accountConfimation.status).toBe(true)
        expect(mockUser.accountConfimation.timestamp).toBeTruthy()
        expect(mockSave).toHaveBeenCalledTimes(1)
        expect(emailService.sendEmail).toHaveBeenCalledWith([mockUser.email], 'Welcome to the base! ', 'Account has been confirmed.')
    })
})
