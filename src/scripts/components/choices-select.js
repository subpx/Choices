import Fuse from 'fuse.js';

import { WrappedSelect } from '../components';
import { TEMPLATES } from '../templates';
import { EVENTS } from '../constants';
import {
  generateId,
  strToEl,
  extend,
  isType,
  getType,
  fetchFromObject,
} from '../lib/utils';
import { addItem, removeItem } from '../actions/items';
import { addGroup } from '../actions/groups';
import {
  activateChoices,
  addChoice,
  clearChoices,
  filterChoices,
} from '../actions/choices';
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

  _addChoice({
    value,
    label = null,
    isSelected = false,
    isDisabled = false,
    groupId = -1,
    customProperties = null,
    placeholder = false,
    keyCode = null,
  }) {
    if (typeof value === 'undefined' || value === null) {
      return;
    }

    // Generate unique id
    const choices = this._store.choices;
    const choiceLabel = label || value;
    const choiceId = choices ? choices.length + 1 : 1;
    const choiceElementId = `${this._baseId}-${
      this._idNames.itemChoice
    }-${choiceId}`;

    this._store.dispatch(
      addChoice({
        value,
        label: choiceLabel,
        id: choiceId,
        groupId,
        disabled: isDisabled,
        elementId: choiceElementId,
        customProperties,
        placeholder,
        keyCode,
      }),
    );

    if (isSelected) {
      this._addItem(
        {
          value,
          label: choiceLabel,
          choiceId,
          customProperties,
          placeholder,
          keyCode,
        },
        true,
      );
    }
  }

  _addGroup({ group, id, valueKey = 'value', labelKey = 'label' }) {
    const groupChoices = isType('Object', group)
      ? group.choices
      : Array.from(group.getElementsByTagName('OPTION'));
    const groupId = id || Math.floor(new Date().valueOf() * Math.random());
    const isDisabled = group.disabled ? group.disabled : false;

    if (groupChoices) {
      this._store.dispatch(addGroup(group.label, groupId, true, isDisabled));

      const addGroupChoices = choice => {
        const isOptDisabled =
          choice.disabled || (choice.parentNode && choice.parentNode.disabled);

        this._addChoice({
          value: choice[valueKey],
          label: isType('Object', choice) ? choice[labelKey] : choice.innerHTML,
          isSelected: choice.selected,
          isDisabled: isOptDisabled,
          groupId,
          customProperties: choice.customProperties,
          placeholder: choice.placeholder,
        });
      };

      groupChoices.forEach(addGroupChoices);
    } else {
      this._store.dispatch(
        addGroup(group.label, group.id, false, group.disabled),
      );
    }
  }

  _addPredefinedItems() {
    const handlePresetItem = item => {
      const itemType = getType(item);
      if (itemType === 'Object' && item.value) {
        this._addItem({
          value: item.value,
          label: item.label,
          choiceId: item.id,
          customProperties: item.customProperties,
          placeholder: item.placeholder,
        });
      } else if (itemType === 'String') {
        this._addItem({
          value: item,
        });
      }
    };

    this._presetItems.forEach(item => handlePresetItem(item));
  }

  _addItem(
    {
      value,
      label = null,
      choiceId = -1,
      groupId = -1,
      customProperties = null,
      placeholder = false,
      keyCode = null,
    },
    removeActiveItems = this.passedElement.type === 'select-one',
  ) {
    let passedValue = isType('String', value) ? value.trim() : value;

    const passedKeyCode = keyCode;
    const passedCustomProperties = customProperties;
    const items = this._store.items;
    const passedLabel = label || passedValue;
    const passedOptionId = parseInt(choiceId, 10) || -1;
    const group = groupId >= 0 ? this._store.getGroupById(groupId) : null;
    const id = items ? items.length + 1 : 1;

    // If a prepended value has been passed, prepend it
    if (this.config.prependValue) {
      passedValue = this.config.prependValue + passedValue.toString();
    }

    // If an appended value has been passed, append it
    if (this.config.appendValue) {
      passedValue += this.config.appendValue.toString();
    }

    this._store.dispatch(
      addItem({
        value: passedValue,
        label: passedLabel,
        id,
        choiceId: passedOptionId,
        groupId,
        customProperties,
        placeholder,
        keyCode: passedKeyCode,
      }),
    );

    if (removeActiveItems) {
      this.removeActiveItems(id);
    }

    // Trigger change event
    if (group && group.value) {
      this.passedElement.triggerEvent(EVENTS.addItem, {
        id,
        value: passedValue,
        label: passedLabel,
        customProperties: passedCustomProperties,
        groupValue: group.value,
        keyCode: passedKeyCode,
      });
    } else {
      this.passedElement.triggerEvent(EVENTS.addItem, {
        id,
        value: passedValue,
        label: passedLabel,
        customProperties: passedCustomProperties,
        keyCode: passedKeyCode,
      });
    }

    return this;
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

  _highlightChoice(el = null) {
    const choices = Array.from(
      this.dropdown.element.querySelectorAll('[data-choice-selectable]'),
    );

    if (!choices.length) {
      return;
    }

    let choiceToHighlight = el;
    const highlightedChoices = Array.from(
      this.dropdown.element.querySelectorAll(
        `.${this.config.classNames.highlightedState}`,
      ),
    );

    // Remove any highlighted choices
    highlightedChoices.forEach(choice => {
      choice.classList.remove(this.config.classNames.highlightedState);
      choice.setAttribute('aria-selected', 'false');
    });

    if (choiceToHighlight) {
      this._highlightPosition = choices.indexOf(choiceToHighlight);
    } else {
      // Highlight choice based on last known highlight location
      if (choices.length > this._highlightPosition) {
        // If we have an option to highlight
        choiceToHighlight = choices[this._highlightPosition];
      } else {
        // Otherwise highlight the option before
        choiceToHighlight = choices[choices.length - 1];
      }

      if (!choiceToHighlight) {
        choiceToHighlight = choices[0];
      }
    }

    choiceToHighlight.classList.add(this.config.classNames.highlightedState);
    choiceToHighlight.setAttribute('aria-selected', 'true');

    if (this.dropdown.isActive) {
      // IE11 ignores aria-label and blocks virtual keyboard
      // if aria-activedescendant is set without a dropdown
      this.input.setActiveDescendant(choiceToHighlight.id);
      this.containerOuter.setActiveDescendant(choiceToHighlight.id);
    }
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

  _handleSearch(value) {
    if (!value || !this.input.isFocussed) {
      return;
    }

    const choices = this._store.choices;
    const { searchFloor, searchChoices } = this.config;
    const hasUnactiveChoices = choices.some(option => !option.active);

    // Check that we have a value to search and the input was an alphanumeric character
    if (value && value.length >= searchFloor) {
      const resultCount = searchChoices ? this._searchChoices(value) : 0;
      // Trigger search event
      this.passedElement.triggerEvent(EVENTS.search, {
        value,
        resultCount,
      });
    } else if (hasUnactiveChoices) {
      // Otherwise reset choices to active
      this._isSearching = false;
      this._store.dispatch(activateChoices(true));
    }
  }

  _findAndSelectChoiceByValue(val) {
    const choices = this._store.choices;
    // Check 'value' property exists and the choice isn't already selected
    const foundChoice = choices.find(choice =>
      this.config.itemComparer(choice.value, val),
    );

    if (foundChoice && !foundChoice.selected) {
      this._addItem({
        value: foundChoice.value,
        label: foundChoice.label,
        id: foundChoice.id,
        groupId: foundChoice.groupId,
        customProperties: foundChoice.customProperties,
        placeholder: foundChoice.placeholder,
        keyCode: foundChoice.keyCode,
      });
    }
  }

  _onTouchMove() {
    if (this._wasTap === true) {
      this._wasTap = false;
    }
  }

  _onBlur({ target }) {
    // If target is something that concerns us
    if (
      this.containerOuter.element.contains(target) &&
      !this._isScrollingOnIe
    ) {
      this.containerOuter.removeFocusState();
      if (
        target === this.input.element ||
        (target === this.containerOuter.element && !this._canSearch)
      ) {
        this.hideDropdown(true);
      }
    } else {
      // On IE11, clicking the scollbar blurs our input and thus
      // closes the dropdown. To stop this, we refocus our input
      // if we know we are on IE *and* are scrolling.
      this._isScrollingOnIe = false;
      this.input.element.focus();
    }
  }

  _onFormReset() {
    this._store.dispatch(resetTo(this._initialState));
  }

  _onMouseOver({ target }) {
    const targetWithinDropdown =
      target === this.dropdown || this.dropdown.element.contains(target);
    const shouldHighlightChoice =
      targetWithinDropdown && target.hasAttribute('data-choice');

    if (shouldHighlightChoice) {
      this._highlightChoice(target);
    }
  }

  clearInput(setWidth = this.passedElement.type === 'select-multiple') {
    this.input.clear();

    if (setWidth) {
      this.input.setWidth();
    }

    if (this._canSearch) {
      this._isSearching = false;
      this._store.dispatch(activateChoices(true));
    }

    return this;
  }

  setChoiceByValue(value) {
    // If only one value has been passed, convert to array
    const choiceValue = isType('Array', value) ? value : [value];

    // Loop through each value and
    choiceValue.forEach(val => this._findAndSelectChoiceByValue(val));

    return this;
  }

  setChoices(choices = [], value = '', label = '', replaceChoices = false) {
    if (!choices.length || !value) {
      return this;
    }

    // Clear choices if needed
    if (replaceChoices) {
      this._clearChoices();
    }

    this.containerOuter.removeLoadingState();
    const addGroupsAndChoices = groupOrChoice => {
      if (groupOrChoice.choices) {
        this._addGroup({
          group: groupOrChoice,
          id: groupOrChoice.id || null,
          valueKey: value,
          labelKey: label,
        });
      } else {
        this._addChoice({
          value: groupOrChoice[value],
          label: groupOrChoice[label],
          isSelected: groupOrChoice.selected,
          isDisabled: groupOrChoice.disabled,
          customProperties: groupOrChoice.customProperties,
          placeholder: groupOrChoice.placeholder,
        });
      }
    };

    choices.forEach(addGroupsAndChoices);

    return this;
  }

  _setChoiceOrItem(item) {
    const itemType = getType(item).toLowerCase();
    const handleType = {
      object: () => {
        if (!item.value) {
          return;
        }

        this._addChoice({
          value: item.value,
          label: item.label,
          isSelected: true,
          isDisabled: false,
          customProperties: item.customProperties,
          placeholder: item.placeholder,
        });
      },
      string: () => {
        this._addChoice({
          value: item,
          label: item,
          isSelected: true,
          isDisabled: false,
        });
      },
    };

    handleType[itemType]();
  }

  _createItemsFragment(items, fragment = null) {
    // Create fragment to add elements to
    const { shouldSortItems, sortFn, removeItemButton } = this.config;
    const itemListFragment = fragment || document.createDocumentFragment();

    // If sorting is enabled, filter items
    if (shouldSortItems) {
      items.sort(sortFn);
    }

    // Update the options of the hidden input
    this.passedElement.options = items;

    const addItemToFragment = item => {
      // Create new list element
      const listItem = this._getTemplate('item', item, removeItemButton);
      // Append it to list
      itemListFragment.appendChild(listItem);
    };

    // Add each list item to list
    items.forEach(item => addItemToFragment(item));

    return itemListFragment;
  }

  _renderItems() {
    const activeItems = this._store.activeItems || [];
    this.itemList.clear();

    if (activeItems.length) {
      // Create a fragment to store our list items
      // (so we don't have to update the DOM for each item)
      const itemListFragment = this._createItemsFragment(activeItems);

      // If we have items to add, append them
      if (itemListFragment.childNodes) {
        this.itemList.append(itemListFragment);
      }
    }
  }

  _ajaxCallback(
    selectPlaceholderChoice = this.passedElement.type === 'select-one',
  ) {
    return (results, value, label) => {
      if (!results || !value) {
        return;
      }

      const parsedResults = isType('Object', results) ? [results] : results;

      if (
        parsedResults &&
        isType('Array', parsedResults) &&
        parsedResults.length
      ) {
        // Remove loading states/text
        this._handleLoadingState(false);
        // Add each result as a choice
        parsedResults.forEach(result => {
          if (result.choices) {
            this._addGroup({
              group: result,
              id: result.id || null,
              valueKey: value,
              labelKey: label,
            });
          } else {
            this._addChoice({
              value: fetchFromObject(result, value),
              label: fetchFromObject(result, label),
              isSelected: result.selected,
              isDisabled: result.disabled,
              customProperties: result.customProperties,
              placeholder: result.placeholder,
            });
          }
        });

        if (selectPlaceholderChoice) {
          this._selectPlaceholderChoice();
        }
      } else {
        // No results, remove loading state
        this._handleLoadingState(false);
      }
    };
  }

  _handleChoiceAction(activeItems, element) {
    if (!activeItems || !element) {
      return;
    }

    // If we are clicking on an option
    const id = element.getAttribute('data-id');
    const choice = this._store.getChoiceById(id);
    const passedKeyCode =
      activeItems[0] && activeItems[0].keyCode ? activeItems[0].keyCode : null;

    // Update choice keyCode
    choice.keyCode = passedKeyCode;

    this.passedElement.triggerEvent(EVENTS.choice, {
      choice,
    });

    if (choice && !choice.selected && !choice.disabled) {
      const canAddItem = this._canAddItem(choice.value);

      if (canAddItem.response) {
        this._addItem(
          {
            value: choice.value,
            label: choice.label,
            choiceId: choice.id,
            groupId: choice.groupId,
            customProperties: choice.customProperties,
            placeholder: choice.placeholder,
            keyCode: choice.keyCode,
          },
          true,
        );

        this._triggerChange(choice.value);
      }
    }

    this.clearInput();
  }

  ajax(fn) {
    if (!fn) {
      return this;
    }

    requestAnimationFrame(() => this._handleLoadingState(true));
    fn(this._ajaxCallback());

    return this;
  }

  destroy() {
    if (!this.initialised) {
      return;
    }

    this.passedElement.reveal();
    this.containerOuter.unwrap(this.passedElement.element);
    this.passedElement.options = this._presetChoices;

    this.clearStore();

    this.config.templates = null;
    this.initialised = false;
  }

  _handleButtonAction(activeItems, element) {
    if (
      !activeItems ||
      !element ||
      !this.config.removeItems ||
      !this.config.removeItemButton
    ) {
      return;
    }

    const itemId = element.parentNode.getAttribute('data-id');
    const itemToRemove = activeItems.find(
      item => item.id === parseInt(itemId, 10),
    );

    // Remove item associated with button
    this._removeItem(itemToRemove);
    this._triggerChange(itemToRemove.value);
  }

  _selectPlaceholderChoice() {
    const placeholderChoice = this._store.placeholderChoice;

    if (placeholderChoice) {
      this._addItem(
        {
          value: placeholderChoice.value,
          label: placeholderChoice.label,
          choiceId: placeholderChoice.id,
          groupId: placeholderChoice.groupId,
          placeholder: placeholderChoice.placeholder,
        },
        true,
      );

      this._triggerChange(placeholderChoice.value);
    }
  }
}
