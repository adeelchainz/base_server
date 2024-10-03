import { getTimezonesForCountry } from 'countries-and-timezones'

export default {
    countryTimezone: (isoCode: string) => {
        return getTimezonesForCountry(isoCode)
    }
}
