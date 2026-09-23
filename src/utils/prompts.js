'use strict';

const inquirer = require('inquirer');

let registered = false;

function ensureSearchPrompts() {
  if (registered) return;
  inquirer.registerPrompt('autocomplete', require('inquirer-autocomplete-prompt'));
  inquirer.registerPrompt('checkbox-plus', require('inquirer-checkbox-plus-prompt'));
  registered = true;
}

// Case-insensitive substring filter shared by searchable lists.
function filterChoicesByInput(choices, input) {
  const query = String(input || '').toLowerCase().trim();
  if (!query) return choices;
  return choices.filter((choice) => {
    const name = typeof choice === 'string' ? choice : choice.name;
    const value = typeof choice === 'string' ? choice : choice.value;
    return String(name).toLowerCase().includes(query)
      || String(value).toLowerCase().includes(query);
  });
}

function searchableList(question, choices) {
  ensureSearchPrompts();
  const normalized = choices.map((choice) => {
    if (typeof choice === 'string') return { name: choice, value: choice };
    return choice;
  });
  return {
    type: 'autocomplete',
    ...question,
    source: (answersSoFar, input) => Promise.resolve(filterChoicesByInput(normalized, input))
  };
}

function searchableCheckbox(question, choices) {
  ensureSearchPrompts();
  const normalized = choices.map((choice) => {
    if (typeof choice === 'string') return { name: choice, value: choice };
    return choice;
  });
  return {
    type: 'checkbox-plus',
    ...question,
    multiple: true,
    source: (answersSoFar, input) => Promise.resolve(filterChoicesByInput(normalized, input))
  };
}

module.exports = {
  ensureSearchPrompts,
  filterChoicesByInput,
  searchableList,
  searchableCheckbox,
  inquirer
};
