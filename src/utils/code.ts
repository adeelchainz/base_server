import { randomInt } from 'crypto'
import { v4 } from 'uuid'

export default {
    generateRandomId: () => v4(),
    generateOTP: (length: number) => {
        const min = Math.pow(10, length - 1)
        const max = Math.pow(10, length) - 1

        return randomInt(min, max).toString()
    }
}
