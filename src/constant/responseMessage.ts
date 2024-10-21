export default {
    SUCCESS: `Operation is completed`,
    SOMETHING_WENT_WRONG: `Something went wrong!`,
    NOT_FOUND: (entity: string) => `${entity} is not found`,
    TOO_MANY_REQUESTS: `So many requests`,
    UNAUTHORIZED: 'You are not allowed to perform this task',

    auth: {
        ALREADY_EXISTS: (entity: string, identifier: string) => `${identifier} already exists for the ${entity}`,
        ALREADY_CONFIRMED: (entity: string) => `${entity} already CONFIRMED`,
        INVALID_PHONE_NUMBER: `Invalid phone number`,
        USER_REGISTERED: `Account has been created successfully.`,
        USER_NOT_EXIST: `Account does not exist`,
        INVALID_EMAIL_OR_PASSWORD: `Invalid email or password`,
        LOGIN_SUCCESSFUL: `Login successful`
    },
    project: {
        CREATED: 'PROJECT CREATED SUCESSFULLY',
        UPDATED: 'PROJECT UPDATED SUCESSFULLY',
        CONFIRMED: 'PROJECT CREATED SUCESSFULLY',
        NOT_FOUND: (entity: string) => `${entity} is not found`,
        ALREADY_EXISTS: (entity: string, identifier: string) => `${identifier} already exists for the ${entity}`,
        ALREADY_CONFIRMED: (entity: string) => `${entity} already CONFIRMED`,
        ALREADY_ASSIGNED: 'Project already assigned',
        ALREADY_ARCHIVED: 'Project already archived',
        ALREADY_REMOVED: 'Project already removed',
        INVALID_CONFIRMATION_DETAILS: 'You have given invalid detailes',
        DELETED: 'Sucessfully deleted the project'
    }
}
