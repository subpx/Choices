import Fuse from 'fuse.js';

import '../lib/polyfills';
import Store from '../store/store';
import { Dropdown, Container, Input, List, WrappedSelect } from '../components';
import { EVENTS, KEY_CODES } from '../constants';
import { TEMPLATES } from '../templates';
import {
  addChoice,
  filterChoices,
  activateChoices,
  clearChoices,
} from '../actions/choices';
import { addItem, removeItem } from '../actions/items';
import { addGroup } from '../actions/groups';
import { clearAll, resetTo } from '../actions/misc';
import {
  isScrolledIntoView,
  getAdjacentEl,
  getType,
  isType,
  strToEl,
  extend,
  sortByScore,
  generateId,
  findAncestorByAttrName,
  fetchFromObject,
  isIE11,
  cloneObject,
} from '../lib/utils';

/**
 * ChoicesSelectOne
 * @author Josh Johnson<josh@joshuajohnson.co.uk>
 */
export default class ChoicesSelectOne {
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

    if (this.config.shouldSortItems === true) {
      if (!this.config.silent) {
        console.warn(
          "shouldSortElements: Type of passed element is 'select-one', falling back to false.",
        );
      }

      this.config.shouldSortItems === false;
    }

    this._store = new Store(this.render);
    this._initialState = {};
    this._currentState = {};
    this._prevState = {};
    this._currentValue = '';
    this._canSearch = this.config.searchEnabled;
    this._isScrollingOnIe = false;
    this._highlightPosition = 0;
    this._wasTap = true;
    this._placeholderValue = null;
    this._baseId = generateId(this.passedElement.element, 'choices-');
    this._direction = this.passedElement.element.getAttribute('dir') || 'ltr';
    this._idNames = {
      itemChoice: 'item-choice',
    };
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
    this.render = this.render.bind(this);
    this._onFocus = this._onFocus.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseOver = this._onMouseOver.bind(this);
    this._onFormReset = this._onFormReset.bind(this);

    // Let's go
    this.init();
  }

  init() {
    if (this.initialised) {
      return;
    }

    this._createTemplates();
    this._createElements();
    this._createStructure();
    // Set initial state (We need to clone the state because some reducers
    // modify the inner objects properties in the state) 🤢
    this._initialState = cloneObject(this._store.state);
    this._store.subscribe(this.render);
    this.render();
    this._addEventListeners();
    this.initialised = true;

    const { callbackOnInit } = this.config;
    // Run callback if it is a function
    if (callbackOnInit && isType('Function', callbackOnInit)) {
      callbackOnInit.call(this);
    }
  }

  destroy() {
    if (!this.initialised) {
      return;
    }

    this._removeEventListeners();
    this.passedElement.reveal();
    this.containerOuter.unwrap(this.passedElement.element);
    this.passedElement.options = this._presetChoices;

    this.clearStore();

    this.config.templates = null;
    this.initialised = false;
  }

  enable() {
    this.passedElement.enable();

    if (this.containerOuter.isDisabled) {
      this._addEventListeners();
      this.input.enable();
      this.containerOuter.enable();
    }

    return this;
  }

  disable() {
    this.passedElement.disable();

    if (!this.containerOuter.isDisabled) {
      this._removeEventListeners();
      this.input.disable();
      this.containerOuter.disable();
    }

    return this;
  }

  render() {
    this._currentState = this._store.state;

    const stateChanged =
      this._currentState.choices !== this._prevState.choices ||
      this._currentState.groups !== this._prevState.groups ||
      this._currentState.items !== this._prevState.items;

    const shouldRenderItems =
      this._currentState.items !== this._prevState.items;

    if (!stateChanged) {
      return;
    }

    this._renderChoices();

    if (shouldRenderItems) {
      this._renderItems();
    }

    this._prevState = this._currentState;
  }

  removeActiveItems(excludedId) {
    this._store.activeItems
      .filter(({ id }) => id !== excludedId)
      .forEach(item => this._removeItem(item));

    return this;
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

  getValue(valueOnly = false) {
    const values = this._store.activeItems.reduce((selectedItems, item) => {
      const itemValue = valueOnly ? item.value : item;
      selectedItems.push(itemValue);
      return selectedItems;
    }, []);

    return values[0];
  }

  setValue(args) {
    [...args].forEach(value => this._setChoiceOrItem(value));
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

  clearStore() {
    this._store.dispatch(clearAll());
    return this;
  }

  clearInput() {
    this.input.clear(false);

    if (this._canSearch) {
      this._isSearching = false;
      this._store.dispatch(activateChoices(true));
    }

    return this;
  }

  ajax(fn) {
    if (!fn) {
      return this;
    }

    requestAnimationFrame(() => this._handleLoadingState(true));
    fn(this._ajaxCallback());

    return this;
  }

  _createGroupsFragment(groups, choices, fragment) {
    const groupFragment = fragment || document.createDocumentFragment();
    const getGroupChoices = group =>
      choices.filter(choice => choice.groupId === group.id);

    // If sorting is enabled, filter groups
    if (this.config.shouldSort) {
      groups.sort(this.config.sortFn);
    }

    groups.forEach(group => {
      const groupChoices = getGroupChoices(group);
      if (groupChoices.length >= 1) {
        const dropdownGroup = this._getTemplate('choiceGroup', group);
        groupFragment.appendChild(dropdownGroup);
        this._createChoicesFragment(groupChoices, groupFragment, true);
      }
    });

    return groupFragment;
  }

  _createChoicesFragment(choices, fragment, withinGroup = false) {
    // Create a fragment to store our list items (so we don't have to update the DOM for each item)
    const choicesFragment = fragment || document.createDocumentFragment();
    const {
      renderSelectedChoices,
      searchResultLimit,
      renderChoiceLimit,
    } = this.config;
    const filter = this._isSearching ? sortByScore : this.config.sortFn;
    const appendChoice = choice => {
      const shouldRender =
        renderSelectedChoices === 'auto' ? !choice.selected : true;
      if (shouldRender) {
        const dropdownItem = this._getTemplate(
          'choice',
          choice,
          this.config.itemSelectText,
        );
        choicesFragment.appendChild(dropdownItem);
      }
    };

    const rendererableChoices = choices;

    // Split array into placeholders and "normal" choices
    const { placeholderChoices, normalChoices } = rendererableChoices.reduce(
      (acc, choice) => {
        if (choice.placeholder) {
          acc.placeholderChoices.push(choice);
        } else {
          acc.normalChoices.push(choice);
        }
        return acc;
      },
      { placeholderChoices: [], normalChoices: [] },
    );

    // If sorting is enabled or the user is searching, filter choices
    if (this.config.shouldSort || this._isSearching) {
      normalChoices.sort(filter);
    }

    let choiceLimit = rendererableChoices.length;

    // Prepend placeholeder
    const sortedChoices = [...placeholderChoices, ...normalChoices];

    if (this._isSearching) {
      choiceLimit = searchResultLimit;
    } else if (renderChoiceLimit > 0 && !withinGroup) {
      choiceLimit = renderChoiceLimit;
    }

    // Add each choice to dropdown within range
    for (let i = 0; i < choiceLimit; i += 1) {
      if (sortedChoices[i]) {
        appendChoice(sortedChoices[i]);
      }
    }

    return choicesFragment;
  }

  _createItemsFragment(items, fragment = null) {
    // Create fragment to add elements to
    const { removeItemButton } = this.config;
    const itemListFragment = fragment || document.createDocumentFragment();

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

  _triggerChange(value) {
    if (value === undefined || value === null) {
      return;
    }

    this.passedElement.triggerEvent(EVENTS.change, {
      value,
    });
  }

  _selectPlaceholderChoice() {
    const placeholderChoice = this._store.placeholderChoice;

    if (placeholderChoice) {
      this._addItem({
        value: placeholderChoice.value,
        label: placeholderChoice.label,
        choiceId: placeholderChoice.id,
        groupId: placeholderChoice.groupId,
        placeholder: placeholderChoice.placeholder,
      });

      this._triggerChange(placeholderChoice.value);
    }
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
    this._selectPlaceholderChoice();
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
    const hasActiveDropdown = this.dropdown.isActive;

    // Update choice keyCode
    choice.keyCode = passedKeyCode;

    this.passedElement.triggerEvent(EVENTS.choice, {
      choice,
    });

    if (choice && !choice.selected && !choice.disabled) {
      const canAddItem = this._canAddItem(activeItems, choice.value);

      if (canAddItem.response) {
        this._addItem({
          value: choice.value,
          label: choice.label,
          choiceId: choice.id,
          groupId: choice.groupId,
          customProperties: choice.customProperties,
          placeholder: choice.placeholder,
          keyCode: choice.keyCode,
        });

        this._triggerChange(choice.value);
      }
    }

    this.clearInput();

    // We wont to close the dropdown if we are dealing with a single select box
    if (hasActiveDropdown) {
      this.hideDropdown(true);
      this.containerOuter.focus();
    }
  }

  _handleLoadingState(isLoading = true) {
    let placeholderItem = this.itemList.getChild(
      `.${this.config.classNames.placeholder}`,
    );
    if (isLoading) {
      this.containerOuter.addLoadingState();
      if (!placeholderItem) {
        placeholderItem = this._getTemplate(
          'placeholder',
          this.config.loadingText,
        );
        this.itemList.append(placeholderItem);
      } else {
        placeholderItem.innerHTML = this.config.loadingText;
      }
    } else {
      this.containerOuter.removeLoadingState();
      placeholderItem.innerHTML = this._placeholderValue || '';
    }
  }

  _canAddItem(activeItems, value) {
    const canAddItem = true;
    const notice = isType('Function', this.config.addItemText)
      ? this.config.addItemText(value)
      : this.config.addItemText;

    return {
      response: canAddItem,
      notice,
    };
  }

  _ajaxCallback() {
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

        this._selectPlaceholderChoice();
      } else {
        // No results, remove loading state
        this._handleLoadingState(false);
      }
    };
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

  _addEventListeners() {
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('click', this._onClick);
    document.addEventListener('touchmove', this._onTouchMove);
    document.addEventListener('touchend', this._onTouchEnd);
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseover', this._onMouseOver);

    this.containerOuter.element.addEventListener('focus', this._onFocus);
    this.containerOuter.element.addEventListener('blur', this._onBlur);

    this.input.element.addEventListener('focus', this._onFocus);
    this.input.element.addEventListener('blur', this._onBlur);

    if (this.input.element.form) {
      this.input.element.form.addEventListener('reset', this._onFormReset);
    }

    this.input.addEventListeners();
  }

  _removeEventListeners() {
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('click', this._onClick);
    document.removeEventListener('touchmove', this._onTouchMove);
    document.removeEventListener('touchend', this._onTouchEnd);
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseover', this._onMouseOver);

    this.containerOuter.element.removeEventListener('focus', this._onFocus);
    this.containerOuter.element.removeEventListener('blur', this._onBlur);

    this.input.element.removeEventListener('focus', this._onFocus);
    this.input.element.removeEventListener('blur', this._onBlur);

    if (this.input.element.form) {
      this.input.element.form.removeEventListener('reset', this._onFormReset);
    }

    this.input.removeEventListeners();
  }

  _onKeyDown(event) {
    const { target, keyCode, ctrlKey, metaKey } = event;

    if (
      target !== this.input.element &&
      !this.containerOuter.element.contains(target)
    ) {
      return;
    }

    const activeItems = this._store.activeItems;
    const hasActiveDropdown = this.dropdown.isActive;
    const hasItems = this.itemList.hasChildren;
    const keyString = String.fromCharCode(keyCode);
    const enterKey = KEY_CODES.ENTER_KEY;
    const aKey = KEY_CODES.A_KEY;
    const escapeKey = KEY_CODES.ESC_KEY;
    const upKey = KEY_CODES.UP_KEY;
    const downKey = KEY_CODES.DOWN_KEY;
    const pageUpKey = KEY_CODES.PAGE_UP_KEY;
    const pageDownKey = KEY_CODES.PAGE_DOWN_KEY;
    const ctrlDownKey = ctrlKey || metaKey;

    // If a user is typing and the dropdown is not active
    if (/[a-zA-Z0-9-_ ]/.test(keyString)) {
      this.showDropdown();
    }

    const onAKey = () => {
      // If CTRL + A or CMD + A have been pressed and there are items to select
      if (ctrlDownKey && hasItems) {
        this._canSearch = false;
        if (
          this.config.removeItems &&
          !this.input.value &&
          this.input.element === document.activeElement
        ) {
          // Highlight items
          this.highlightAll();
        }
      }
    };

    const onEnterKey = () => {
      if (target.hasAttribute('data-button')) {
        this._handleButtonAction(activeItems, target);
        event.preventDefault();
      }

      if (hasActiveDropdown) {
        event.preventDefault();
        const highlighted = this.dropdown.getChild(
          `.${this.config.classNames.highlightedState}`,
        );

        // If we have a highlighted choice
        if (highlighted) {
          // add enter keyCode value
          if (activeItems[0]) {
            activeItems[0].keyCode = enterKey;
          }
          this._handleChoiceAction(activeItems, highlighted);
        }
      } else {
        // Open single select dropdown if it's not active
        this.showDropdown();
        event.preventDefault();
      }
    };

    const onEscapeKey = () => {
      if (hasActiveDropdown) {
        this.hideDropdown(true);
        this.containerOuter.focus();
      }
    };

    const onDirectionKey = () => {
      // If up or down key is pressed, traverse through options
      if (hasActiveDropdown) {
        this.showDropdown();
        this._canSearch = false;

        const directionInt =
          keyCode === downKey || keyCode === pageDownKey ? 1 : -1;
        const skipKey =
          metaKey || keyCode === pageDownKey || keyCode === pageUpKey;
        const selectableChoiceIdentifier = '[data-choice-selectable]';

        let nextEl;
        if (skipKey) {
          if (directionInt > 0) {
            nextEl = Array.from(
              this.dropdown.element.querySelectorAll(
                selectableChoiceIdentifier,
              ),
            ).pop();
          } else {
            nextEl = this.dropdown.element.querySelector(
              selectableChoiceIdentifier,
            );
          }
        } else {
          const currentEl = this.dropdown.element.querySelector(
            `.${this.config.classNames.highlightedState}`,
          );
          if (currentEl) {
            nextEl = getAdjacentEl(
              currentEl,
              selectableChoiceIdentifier,
              directionInt,
            );
          } else {
            nextEl = this.dropdown.element.querySelector(
              selectableChoiceIdentifier,
            );
          }
        }

        if (nextEl) {
          // We prevent default to stop the cursor moving
          // when pressing the arrow
          if (
            !isScrolledIntoView(nextEl, this.choiceList.element, directionInt)
          ) {
            this.choiceList.scrollToChoice(nextEl, directionInt);
          }
          this._highlightChoice(nextEl);
        }

        // Prevent default to maintain cursor position whilst
        // traversing dropdown options
        event.preventDefault();
      }
    };

    // Map keys to key actions
    const keyDownActions = {
      [aKey]: onAKey,
      [enterKey]: onEnterKey,
      [escapeKey]: onEscapeKey,
      [upKey]: onDirectionKey,
      [pageUpKey]: onDirectionKey,
      [downKey]: onDirectionKey,
      [pageDownKey]: onDirectionKey,
    };

    // If keycode has a function, run it
    if (keyDownActions[keyCode]) {
      keyDownActions[keyCode]();
    }
  }

  _onKeyUp({ target, keyCode }) {
    if (target !== this.input.element) {
      return;
    }

    const value = this.input.value;
    const activeItems = this._store.activeItems;
    const canAddItem = this._canAddItem(activeItems, value);
    const backKey = KEY_CODES.BACK_KEY;
    const deleteKey = KEY_CODES.DELETE_KEY;

    // If user has removed value...
    if ((keyCode === backKey || keyCode === deleteKey) && !target.value) {
      if (this._isSearching) {
        this._isSearching = false;
        this._store.dispatch(activateChoices(true));
      }
    } else if (this._canSearch && canAddItem.response) {
      this._handleSearch(this.input.value);
    }

    this._canSearch = this.config.searchEnabled;
  }

  _onTouchMove() {
    if (this._wasTap === true) {
      this._wasTap = false;
    }
  }

  _onTouchEnd(event) {
    const target = event.target || event.touches[0].target;

    // If a user tapped within our container...
    if (this._wasTap === true && this.containerOuter.element.contains(target)) {
      // Prevents focus event firing
      event.stopPropagation();
    }

    this._wasTap = true;
  }

  _onMouseDown(event) {
    const { target } = event;
    // If we have our mouse down on the scrollbar and are on IE11...
    if (target === this.choiceList && isIE11()) {
      this._isScrollingOnIe = true;
    }

    if (
      !this.containerOuter.element.contains(target) ||
      target === this.input.element
    ) {
      return;
    }

    const activeItems = this._store.activeItems;

    const buttonTarget = findAncestorByAttrName(target, 'data-button');
    const choiceTarget = findAncestorByAttrName(target, 'data-choice');

    if (buttonTarget) {
      this._handleButtonAction(activeItems, buttonTarget);
    } else if (choiceTarget) {
      this._handleChoiceAction(activeItems, choiceTarget);
    }

    event.preventDefault();
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

  _onClick({ target }) {
    if (this.containerOuter.element.contains(target)) {
      if (!this.dropdown.isActive) {
        this.showDropdown();
        this.containerOuter.focus();
      } else if (
        target !== this.input.element &&
        !this.dropdown.element.contains(target)
      ) {
        this.hideDropdown();
      }
    } else {
      this.containerOuter.removeFocusState();
      this.hideDropdown(true);
    }
  }

  _onFocus({ target }) {
    if (!this.containerOuter.element.contains(target)) {
      return;
    }

    this.containerOuter.addFocusState();

    if (target === this.input.element) {
      this.showDropdown(true);
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

  _highlightChoice(el = null) {
    const choices = Array.from(
      this.dropdown.element.querySelectorAll('[data-choice-selectable]'),
    );

    if (!choices.length) {
      return;
    }

    let passedEl = el;
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

    if (passedEl) {
      this._highlightPosition = choices.indexOf(passedEl);
    } else {
      // Highlight choice based on last known highlight location
      if (choices.length > this._highlightPosition) {
        // If we have an option to highlight
        passedEl = choices[this._highlightPosition];
      } else {
        // Otherwise highlight the option before
        passedEl = choices[choices.length - 1];
      }

      if (!passedEl) {
        passedEl = choices[0];
      }
    }

    passedEl.classList.add(this.config.classNames.highlightedState);
    passedEl.setAttribute('aria-selected', 'true');

    if (this.dropdown.isActive) {
      // IE11 ignores aria-label and blocks virtual keyboard
      // if aria-activedescendant is set without a dropdown
      this.input.setActiveDescendant(passedEl.id);
      this.containerOuter.setActiveDescendant(passedEl.id);
    }
  }

  _addItem({
    value,
    label = null,
    choiceId = -1,
    groupId = -1,
    customProperties = null,
    placeholder = false,
    keyCode = null,
  }) {
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

    this.removeActiveItems(id);

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
      this._addItem({
        value,
        label: choiceLabel,
        choiceId,
        customProperties,
        placeholder,
        keyCode,
      });
    }
  }

  _clearChoices() {
    this._store.dispatch(clearChoices());
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

  _getTemplate(template, ...args) {
    if (!template) {
      return null;
    }

    const { templates, classNames } = this.config;
    return templates[template].call(this, classNames, ...args);
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

  _createElements() {
    this.containerOuter = new Container({
      element: this._getTemplate(
        'containerOuter',
        this._direction,
        this.config.searchEnabled,
        'select-one',
      ),
      classNames: this.config.classNames,
      type: 'select-one',
      position: this.config.position,
    });

    this.containerInner = new Container({
      element: this._getTemplate('containerInner'),
      classNames: this.config.classNames,
      type: 'select-one',
      position: this.config.position,
    });

    this.input = new Input({
      element: this._getTemplate('input'),
      classNames: this.config.classNames,
      type: 'select-one',
    });

    this.choiceList = new List({
      element: this._getTemplate(
        'choiceList',
        true, // isSelectOneElement
      ),
    });

    this.itemList = new List({
      element: this._getTemplate(
        'itemList',
        true, // isSelectOneElement
      ),
    });

    this.dropdown = new Dropdown({
      element: this._getTemplate('dropdown'),
      classNames: this.config.classNames,
      type: 'select-one',
    });
  }

  _createStructure() {
    // Hide original element
    this.passedElement.conceal();
    // Wrap input in container preserving DOM ordering
    this.containerInner.wrap(this.passedElement.element);
    // Wrapper inner container with outer container
    this.containerOuter.wrap(this.containerInner.element);

    this.input.placeholder = this.config.searchPlaceholderValue || '';

    if (!this.config.addItems) {
      this.disable();
    }

    this.containerOuter.element.appendChild(this.containerInner.element);
    this.containerOuter.element.appendChild(this.dropdown.element);
    this.containerInner.element.appendChild(this.itemList.element);

    this.dropdown.element.appendChild(this.choiceList.element);
    this.dropdown.element.insertBefore(
      this.input.element,
      this.dropdown.element.firstChild,
    );

    this._addPredefinedChoices();
  }

  _addPredefinedChoices() {
    const passedGroups = this.passedElement.optionGroups;

    this._highlightPosition = 0;
    this._isSearching = false;

    if (passedGroups && passedGroups.length) {
      // If we have a placeholder option
      const placeholderChoice = this.passedElement.placeholderOption;
      if (
        placeholderChoice &&
        placeholderChoice.parentNode.tagName === 'SELECT'
      ) {
        this._addChoice({
          value: placeholderChoice.value,
          label: placeholderChoice.innerHTML,
          isSelected: placeholderChoice.selected,
          isDisabled: placeholderChoice.disabled,
          placeholder: true,
        });
      }

      passedGroups.forEach(group =>
        this._addGroup({
          group,
          id: group.id || null,
        }),
      );
    } else {
      const passedOptions = this.passedElement.options;
      const filter = this.config.sortFn;
      const allChoices = this._presetChoices;

      // Create array of options from option elements
      passedOptions.forEach(o => {
        allChoices.push({
          value: o.value,
          label: o.innerHTML,
          selected: o.selected,
          disabled: o.disabled || o.parentNode.disabled,
          placeholder: o.hasAttribute('placeholder'),
        });
      });

      // If sorting is enabled or the user is searching, filter choices
      if (this.config.shouldSort) {
        allChoices.sort(filter);
      }

      // Determine whether there is a selected choice
      const hasSelectedChoice = allChoices.some(choice => choice.selected);
      const handleChoice = (choice, index) => {
        const { value, label, customProperties, placeholder } = choice;

        // If the choice is actually a group
        if (choice.choices) {
          this._addGroup({
            group: choice,
            id: choice.id || null,
          });
        } else {
          // If there is a selected choice already or the choice is not
          // the first in the array, add each choice normally
          // Otherwise pre-select the first choice in the array if it's a single select
          const shouldPreselect = !hasSelectedChoice && index === 0;
          const isSelected = shouldPreselect ? true : choice.selected;
          const isDisabled = shouldPreselect ? false : choice.disabled;

          this._addChoice({
            value,
            label,
            isSelected,
            isDisabled,
            customProperties,
            placeholder,
          });
        }
      };

      // Add each choice
      allChoices.forEach((choice, index) => handleChoice(choice, index));
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

  _renderChoices() {
    const { activeGroups, activeChoices } = this._store;
    let choiceListFragment = document.createDocumentFragment();

    this.choiceList.clear();

    if (this.config.resetScrollPosition) {
      requestAnimationFrame(() => this.choiceList.scrollToTop());
    }

    // If we have grouped options
    if (activeGroups.length >= 1 && !this._isSearching) {
      // If we have a placeholder choice along with groups
      const activePlaceholders = activeChoices.filter(
        activeChoice =>
          activeChoice.placeholder === true && activeChoice.groupId === -1,
      );
      if (activePlaceholders.length >= 1) {
        choiceListFragment = this._createChoicesFragment(
          activePlaceholders,
          choiceListFragment,
        );
      }
      choiceListFragment = this._createGroupsFragment(
        activeGroups,
        activeChoices,
        choiceListFragment,
      );
    } else if (activeChoices.length >= 1) {
      choiceListFragment = this._createChoicesFragment(
        activeChoices,
        choiceListFragment,
      );
    }

    // If we have choices to show
    if (
      choiceListFragment.childNodes &&
      choiceListFragment.childNodes.length > 0
    ) {
      const activeItems = this._store.activeItems;
      const canAddItem = this._canAddItem(activeItems, this.input.value);

      // ...and we can select them
      if (canAddItem.response) {
        // ...append them and highlight the first choice
        this.choiceList.append(choiceListFragment);
        this._highlightChoice();
      } else {
        // ...otherwise show a notice
        this.choiceList.append(this._getTemplate('notice', canAddItem.notice));
      }
    } else {
      // Otherwise show a notice
      let dropdownItem;
      let notice;

      if (this._isSearching) {
        notice = isType('Function', this.config.noResultsText)
          ? this.config.noResultsText()
          : this.config.noResultsText;

        dropdownItem = this._getTemplate('notice', notice, 'no-results');
      } else {
        notice = isType('Function', this.config.noChoicesText)
          ? this.config.noChoicesText()
          : this.config.noChoicesText;

        dropdownItem = this._getTemplate('notice', notice, 'no-choices');
      }

      this.choiceList.append(dropdownItem);
    }
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
}
