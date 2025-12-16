import Joi from 'joi';

export const objectId = (value: string, helpers: any) => {
  if (!value.match(/^[0-9a-fA-F]{24}$/)) {
    return helpers.message('"{{#label}}" phải là một ID hợp lệ');
  }
  return value;
};