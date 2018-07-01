import '../lib/polyfills';
import { DEFAULT_CONFIG, DEFAULT_CLASSNAMES } from '../constants';
import { isType, extend, sortByAlpha } from '../lib/utils';

/**
 * ChoicesCore
 * @author Josh Johnson<josh@joshuajohnson.co.uk>
 */
export default class ChoicesCore {
  constructor(element = '[data-choice]', userConfig = {}) {
    const passedElement = isType('String', element)
      ? document.querySelector(element)
      : element;

    // If element has already been initialised with Choices, fail silently
    if (passedElement.getAttribute('data-choice') === 'active') {
      console.warn(
        'Trying to initialise Choices on element already initialised',
      );
    }

    this._passedElement = passedElement;
    this.initialised = false;
    this.config = ChoicesCore._generateConfig(userConfig);
  }

  static _generateConfig(userConfig) {
    const defaultConfig = {
      ...DEFAULT_CONFIG,
      items: [],
      choices: [],
      classNames: DEFAULT_CLASSNAMES,
      sortFn: sortByAlpha,
    };

    return extend(defaultConfig, ChoicesCore.userDefaults, userConfig);
  }
}
