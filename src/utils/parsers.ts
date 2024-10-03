import { parsePhoneNumber } from 'libphonenumber-js'

export default {
    parsePhoneNumber: (phoneNumber: string) => {
        try {
            const parsedPhoneNumber = parsePhoneNumber(phoneNumber)

            if (parsedPhoneNumber) {
                return {
                    countryCode: parsedPhoneNumber.countryCallingCode,
                    isoCode: parsedPhoneNumber.country || null,
                    internationalNumber: parsedPhoneNumber.formatInternational()
                }
            }

            return {
                countryCode: null,
                isoCode: null,
                internationalNumber: null
            }
        } catch (error) {
            return {
                error: error,
                countryCode: null,
                isoCode: null,
                internationalNumber: null
            }
        }
    }
}
