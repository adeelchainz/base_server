import { createLogger, format, transports } from 'winston'
import util from 'util'
import { ConsoleTransportInstance, FileTransportInstance } from 'winston/lib/winston/transports'
import config from '../config/config'
import { EApplicationEnvironment } from '../constant/application'
import path from 'path'

const logFormat = format.printf((info) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { level, message, timestamp, meta = {} } = info

    const customLevel = level.toUpperCase()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const customTimestamp = timestamp
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const customMessage = message
    const customMeta = util.inspect(meta, {
        showHidden: false,
        depth: null
    })

    const customLog = `${customLevel} [${customTimestamp}] ${customMessage}\n${'Meta'} ${customMeta}\n`

    return customLog
})

const fileFormat = format.printf((info) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { level, message, timestamp, meta = {} } = info

    const logMeta: Record<string, unknown> = {}

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    for (const [key, value] of Object.entries(meta)) {
        if (value instanceof Error) {
            logMeta[key] = {
                name: value.name,
                message: value.message,
                trace: value.stack || ''
            }
        } else {
            logMeta[key] = value
        }
    }

    const logData = {
        level: level.toUpperCase(),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        timestamp,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        message,
        meta: logMeta
    }

    return JSON.stringify(logData, null, 4)
})

const consoleTransport = (): Array<ConsoleTransportInstance> => {
    if (config.ENV === EApplicationEnvironment.DEVELOPMENT) {
        return [
            new transports.Console({
                level: 'info',
                format: format.combine(format.timestamp(), logFormat)
            })
        ]
    }
    return []
}

const fileTransport = (): Array<FileTransportInstance> => {
    if (config.ENV === EApplicationEnvironment.DEVELOPMENT) {
        return [
            new transports.File({
                filename: path.join(__dirname, '../', '../', 'logs', `${config.ENV}.log`),
                level: 'info',
                format: format.combine(format.timestamp(), fileFormat)
            })
        ]
    }
    return []
}

export default createLogger({
    defaultMeta: {
        meta: {}
    },
    transports: [...fileTransport(), ...consoleTransport()]
})
