import Fuse from 'fuse.js';

import { WrappedSelect } from '../components';
import { TEMPLATES } from '../templates';
import { EVENTS } from '../constants';
import { generateId, strToEl, extend, isType } from '../lib/utils';
import { removeItem } from '../actions/items';
import { clearChoices, filterChoices } from '../actions/choices';
import { clearAll, resetTo } from '../actions/misc';

/**
 * ChoicesSelect
 * @author Josh Johnson<josh@joshuajohnson.co.uk>
 */

export default class ChoicesSelect {
  constructor(element, config) {
    this.initialised = false;
    this.config = config;

    if (!['auto', 'always'].includes(this.config.renderSelectedChoices)) {
      this.config.renderSelectedChoices = 'auto';
    }

    this.passedElement = new WrappedSelect({
      element,
      classNames: this.config.classNames,
    });

    this._initialState = {};
    this._currentState = {};
    this._prevState = {};
    this._baseId = generateId(this.passedElement.element, 'choices-');
    this._idNames = {
      itemChoice: 'item-choice',
    };
    this._currentValue = '';
    this._canSearch = this.config.searchEnabled;
    this._isScrollingOnIe = false;
    this._highlightPosition = 0;
    this._wasTap = true;
    this._direction = this.passedElement.element.getAttribute('dir') || 'ltr';

    // Assign preset choices from passed object
    this._presetChoices = this.config.choices;
    // Assign preset items from passed object first
    this._presetItems = this.config.items;
    // Then add any values passed from attribute
    if (this.passedElement.value) {
      this._presetItems = this._presetItems.concat(
        this.passedElement.value.split(this.config.delimiter),
      );
    }
  }

  showDropdown(preventInputFocus) {
    if (this.dropdown.isActive) {
      return this;
    }

    requestAnimationFrame(() => {
      this.dropdown.show();
      this.containerOuter.open(this.dropdown.distanceFromTopWindow());

      if (!preventInputFocus && this._canSearch) {
        this.input.focus();
      }

      this.passedElement.triggerEvent(EVENTS.showDropdown, {});
    });

    return this;
  }

  hideDropdown(preventInputBlur) {
    if (!this.dropdown.isActive) {
      return this;
    }

    requestAnimationFrame(() => {
      this.dropdown.hide();
      this.containerOuter.close();

      if (!preventInputBlur && this._canSearch) {
        this.input.removeActiveDescendant();
        this.input.blur();
      }

      this.passedElement.triggerEvent(EVENTS.hideDropdown, {});
    });

    return this;
  }

  toggleDropdown() {
    this.dropdown.isActive ? this.hideDropdown() : this.showDropdown();
    return this;
  }

  getValue(valueOnly = false) {
    const values = this._store.activeItems.reduce((selectedItems, item) => {
      const itemValue = valueOnly ? item.value : item;
      selectedItems.push(itemValue);
      return selectedItems;
    }, []);

    return values;
  }

  setValue(args) {
    [...args].forEach(value => this._setChoiceOrItem(value));
    return this;
  }

  removeActiveItems(excludedId) {
    this._store.activeItems
      .filter(({ id }) => id !== excludedId)
      .forEach(item => this._removeItem(item));

    return this;
  }

  clearStore() {
    this._store.dispatch(clearAll());
    return this;
  }

  _createTemplates() {
    const { callbackOnCreateTemplates } = this.config;
    let userTemplates = {};

    if (
      callbackOnCreateTemplates &&
      isType('Function', callbackOnCreateTemplates)
    ) {
      userTemplates = callbackOnCreateTemplates.call(this, strToEl);
    }

    this.config.templates = extend(TEMPLATES, userTemplates);
  }

  _removeItem(item) {
    if (!item || !isType('Object', item)) {
      return this;
    }

    const { id, value, label, choiceId, groupId } = item;
    const group = groupId >= 0 ? this._store.getGroupById(groupId) : null;

    this._store.dispatch(removeItem(id, choiceId));

    if (group && group.value) {
      this.passedElement.triggerEvent(EVENTS.removeItem, {
        id,
        value,
        label,
        groupValue: group.value,
      });
    } else {
      this.passedElement.triggerEvent(EVENTS.removeItem, {
        id,
        value,
        label,
      });
    }

    return this;
  }

  _getTemplate(template, ...args) {
    if (!template) {
      return null;
    }

    const { templates, classNames } = this.config;
    return templates[template].call(this, classNames, ...args);
  }

  _clearChoices() {
    this._store.dispatch(clearChoices());
  }

  _triggerChange(value) {
    if (value === undefined || value === null) {
      return;
    }

    this.passedElement.triggerEvent(EVENTS.change, {
      value,
    });
  }

  _searchChoices(value) {
    const newValue = isType('String', value) ? value.trim() : value;
    const currentValue = isType('String', this._currentValue)
      ? this._currentValue.trim()
      : this._currentValue;

    if (newValue.length < 1 && newValue === `${currentValue} `) {
      return 0;
    }

    // If new value matches the desired length and is not the same as the current value with a space
    const haystack = this._store.searchableChoices;
    const needle = newValue;
    const keys = [...this.config.searchFields];
    const options = Object.assign(this.config.fuseOptions, { keys });
    const fuse = new Fuse(haystack, options);
    const results = fuse.search(needle);

    this._currentValue = newValue;
    this._highlightPosition = 0;
    this._isSearching = true;
    this._store.dispatch(filterChoices(results));

    return results.length;
  }

  _onFormReset() {
    this._store.dispatch(resetTo(this._initialState));
  }
}
