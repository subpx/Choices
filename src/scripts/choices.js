import './lib/polyfills';
import { DEFAULT_CONFIG, DEFAULT_CLASSNAMES } from './constants';
import { isType, extend, sortByAlpha } from './lib/utils';
import {
  ChoicesInput,
  ChoicesSelectOne,
  ChoicesSelectMultiple,
} from './components';

/**
 * Choices
 * @author Josh Johnson<josh@joshuajohnson.co.uk>
 */
class Choices {
  constructor(element = '[data-choice]', userConfig = {}) {
    if (isType('String', element)) {
      const elements = Array.from(document.querySelectorAll(element));

      // If there are multiple elements, create a new instance
      // for each element besides the first one (as that already has an instance)
      if (elements.length > 1) {
        return this._generateInstances(elements, userConfig);
      }
    }

    const passedElement = isType('String', element)
      ? document.querySelector(element)
      : element;

    // If element has already been initialised with Choices, fail silently
    if (passedElement.getAttribute('data-choice') === 'active') {
      console.warn(
        'Trying to initialise Choices on element already initialised',
      );
    }

    const config = Choices._generateConfig(userConfig);

    switch (passedElement.type) {
      case 'select-multiple':
        return new ChoicesSelectMultiple(passedElement, config);

      case 'select-one':
        return new ChoicesSelectOne(passedElement, config);

      case 'text':
        return new ChoicesInput(passedElement, config);

      default:
        throw new TypeError('Unrecognised element passed');
    }
  }

  _generateInstances(elements, config) {
    return elements.reduce(
      (instances, element) => {
        instances.push(new Choices(element, config));
        return instances;
      },
      [this],
    );
  }

  static _generateConfig(userConfig) {
    const defaultConfig = {
      ...DEFAULT_CONFIG,
      items: [],
      choices: [],
      classNames: DEFAULT_CLASSNAMES,
      sortFn: sortByAlpha,
    };

    return extend(defaultConfig, Choices.userDefaults, userConfig);
  }
}

module.exports = Choices;
