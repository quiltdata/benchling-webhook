// Mock chalk for Jest tests
const identity = (str: string) => str;

const chalk = {
    red: identity,
    green: identity,
    yellow: identity,
    blue: identity,
    cyan: identity,
    magenta: identity,
    white: identity,
    gray: identity,
    bold: identity,
    dim: identity,
    italic: identity,
    underline: identity,
    inverse: identity,
    strikethrough: identity,
};

export default chalk;
