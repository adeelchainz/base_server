export default {
    SUCCESS: `Operation is completed`,
    SOMETHING_WENT_WRONG: `Something went wrong!`,
    NOT_FOUND: (entity: string) => `${entity} is not found`,
    TOO_MANY_REQUESTS: `So many requests`,

    auth: {
        INVALID_PHONE_NUMBER: `Invalid phone number`,
        USER_REGISTERED: `Account has been created successfully.`,
        ALREADY_EXISTS: (entity: string, identifier: string) => `${identifier} already exists for the ${entity}`,
        USER_NOT_EXIST: `Account does not exist`,
        ALREADY_CONFIRMED: (entity: string) => `${entity} already CONFIRMED`
    }
}
