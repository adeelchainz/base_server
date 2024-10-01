import joi from 'joi'

export const validateSchema = <T>(schema: joi.Schema, value: unknown) => {
    const result = schema.validate(value)

    return {
        payload: result.value as T,
        error: result.error
    }
}
