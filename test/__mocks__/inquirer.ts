const inquirer = {
  prompt: jest.fn(),
  createPromptModule: jest.fn(() => jest.fn()),
};

export default inquirer;
module.exports = { default: inquirer, ...inquirer };
