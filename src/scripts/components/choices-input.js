import Fuse from 'fuse.js';

import '../lib/polyfills';
import Store from '../store/store';
import { Dropdown, Container, Input, List, WrappedInput } from '../components';
import { EVENTS, KEY_CODES } from '../constants';
import { TEMPLATES } from '../templates';
import {
  addChoice,
  filterChoices,
  activateChoices,
  clearChoices,
} from '../actions/choices';
import { addItem, removeItem, highlightItem } from '../actions/items';
import { addGroup } from '../actions/groups';
import { clearAll, resetTo } from '../actions/misc';
import {
  isScrolledIntoView,
  getAdjacentEl,
  getType,
  isType,
  strToEl,
  extend,
  generateId,
  findAncestorByAttrName,
  regexFilter,
  fetchFromObject,
  isIE11,
  existsInArray,
  cloneObject,
} from '../lib/utils';

/**
 * ChoicesInput
 * @author Josh Johnson<josh@joshuajohnson.co.uk>
 */
export default class ChoicesInput {
  constructor(element, config) {
    this.initialised = false;
    this.config = config;

    if (!['auto', 'always'].includes(this.config.renderSelectedChoices)) {
      this.config.renderSelectedChoices = 'auto';
    }

    this._isSelectElement =
      this._isSelectOneElement || this._isSelectMultipleElement;

    this.passedElement = new WrappedInput({
      element,
      classNames: this.config.classNames,
      delimiter: this.config.delimiter,
    });

    this._store = new Store(this.render);
    this._initialState = {};
    this._currentState = {};
    this._prevState = {};
    this._currentValue = '';
    this._canSearch = this.config.searchEnabled;
    this._isScrollingOnIe = false;
    this._highlightPosition = 0;
    this._wasTap = true;
    this._placeholderValue = this._generatePlaceholderValue();
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

    // If element has already been initialised with ChoicesInput, fail silently
    if (this.passedElement.element.getAttribute('data-choice') === 'active') {
      console.warn(
        'Trying to initialise ChoicesInput on element already initialised',
      );
    }

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

    this.clearStore();

    this.config.templates = null;
    this.initialised = false;
  }

  enable() {
    if (!this.initialised) {
      return this;
    }

    this.passedElement.enable();

    if (this.containerOuter.isDisabled) {
      this._addEventListeners();
      this.input.enable();
      this.containerOuter.enable();
    }

    return this;
  }

  disable() {
    if (!this.initialised) {
      return this;
    }

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

    if (shouldRenderItems) {
      this._renderItems();
    }

    this._prevState = this._currentState;
  }

  highlightItem(item, runEvent = true) {
    if (!item) {
      return this;
    }

    const { id, groupId = -1, value = '', label = '' } = item;
    const group = groupId >= 0 ? this._store.getGroupById(groupId) : null;

    this._store.dispatch(highlightItem(id, true));

    if (runEvent) {
      this.passedElement.triggerEvent(EVENTS.highlightItem, {
        id,
        value,
        label,
        groupValue: group && group.value ? group.value : null,
      });
    }

    return this;
  }

  unhighlightItem(item) {
    if (!item) {
      return this;
    }

    const { id, groupId = -1, value = '', label = '' } = item;
    const group = groupId >= 0 ? this._store.getGroupById(groupId) : null;

    this._store.dispatch(highlightItem(id, false));
    this.passedElement.triggerEvent(EVENTS.highlightItem, {
      id,
      value,
      label,
      groupValue: group && group.value ? group.value : null,
    });

    return this;
  }

  highlightAll() {
    this._store.items.forEach(item => this.highlightItem(item));
    return this;
  }

  unhighlightAll() {
    this._store.items.forEach(item => this.unhighlightItem(item));
    return this;
  }

  removeActiveItemsByValue(value) {
    this._store.activeItems
      .filter(item => item.value === value)
      .forEach(item => this._removeItem(item));

    return this;
  }

  removeActiveItems(excludedId) {
    this._store.activeItems
      .filter(({ id }) => id !== excludedId)
      .forEach(item => this._removeItem(item));

    return this;
  }

  removeHighlightedItems(runEvent = false) {
    this._store.highlightedActiveItems.forEach(item => {
      this._removeItem(item);
      // If this action was performed by the user
      // trigger the event
      if (runEvent) {
        this._triggerChange(item.value);
      }
    });

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
    if (!this.initialised) {
      return this;
    }

    [...args].forEach(value => this._setChoiceOrItem(value));
    return this;
  }

  clearStore() {
    this._store.dispatch(clearAll());
    return this;
  }

  clearInput() {
    this.input.clear(true);
    return this;
  }

  _createItemsFragment(items, fragment = null) {
    // Create fragment to add elements to
    const { shouldSortItems, sortFn, removeItemButton } = this.config;
    const itemListFragment = fragment || document.createDocumentFragment();

    // If sorting is enabled, filter items
    if (shouldSortItems) {
      items.sort(sortFn);
    }

    // Update the value of the hidden input
    this.passedElement.value = items;

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

  _handleItemAction(activeItems, element, hasShiftKey = false) {
    if (!activeItems || !element || !this.config.removeItems) {
      return;
    }

    const passedId = element.getAttribute('data-id');

    // We only want to select one item with a click
    // so we deselect any items that aren't the target
    // unless shift is being pressed
    activeItems.forEach(item => {
      if (item.id === parseInt(passedId, 10) && !item.highlighted) {
        this.highlightItem(item);
      } else if (!hasShiftKey && item.highlighted) {
        this.unhighlightItem(item);
      }
    });

    // Focus input as without focus, a user cannot do anything with a
    // highlighted item
    this.input.focus();
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
  }

  _handleBackspace(activeItems) {
    if (!this.config.removeItems || !activeItems) {
      return;
    }

    const lastItem = activeItems[activeItems.length - 1];
    const hasHighlightedItems = activeItems.some(item => item.highlighted);

    // If editing the last item is allowed and there are not other selected items,
    // we can edit the item value. Otherwise if we can remove items, remove all selected items
    if (this.config.editItems && !hasHighlightedItems && lastItem) {
      this.input.value = lastItem.value;
      this.input.setWidth();
      this._removeItem(lastItem);
      this._triggerChange(lastItem.value);
    } else {
      if (!hasHighlightedItems) {
        // Highlight last item if none already highlighted
        this.highlightItem(lastItem, false);
      }
      this.removeHighlightedItems(true);
    }
  }

  _handleLoadingState(isLoading = true) {
    if (isLoading) {
      this.containerOuter.addLoadingState();
      this.input.placeholder = this.config.loadingText;
    } else {
      this.containerOuter.removeLoadingState();
      this.input.placeholder = this._placeholderValue || '';
    }
  }

  _canAddItem(activeItems, value) {
    let canAddItem = true;
    let notice = isType('Function', this.config.addItemText)
      ? this.config.addItemText(value)
      : this.config.addItemText;

    const isDuplicateValue = existsInArray(activeItems, value);

    if (
      this.config.maxItemCount > 0 &&
      this.config.maxItemCount <= activeItems.length
    ) {
      // If there is a max entry limit and we have reached that limit
      // don't update
      canAddItem = false;
      notice = isType('Function', this.config.maxItemText)
        ? this.config.maxItemText(this.config.maxItemCount)
        : this.config.maxItemText;
    }

    if (this.config.regexFilter && this.config.addItems && canAddItem) {
      // If a user has supplied a regular expression filter
      // determine whether we can update based on whether
      // our regular expression passes
      canAddItem = regexFilter(value, this.config.regexFilter);
    }

    if (!this.config.duplicateItemsAllowed && isDuplicateValue && canAddItem) {
      canAddItem = false;
      notice = isType('Function', this.config.uniqueItemText)
        ? this.config.uniqueItemText(value)
        : this.config.uniqueItemText;
    }

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
    const options = Object.assign(this.config.fuseOptions, {
      keys,
    });
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
    const hasFocusedInput = this.input.isFocussed;
    const hasActiveDropdown = this.dropdown.isActive;
    const hasItems = this.itemList.hasChildren;
    const backKey = KEY_CODES.BACK_KEY;
    const deleteKey = KEY_CODES.DELETE_KEY;
    const enterKey = KEY_CODES.ENTER_KEY;
    const aKey = KEY_CODES.A_KEY;
    const escapeKey = KEY_CODES.ESC_KEY;
    const upKey = KEY_CODES.UP_KEY;
    const downKey = KEY_CODES.DOWN_KEY;
    const pageUpKey = KEY_CODES.PAGE_UP_KEY;
    const pageDownKey = KEY_CODES.PAGE_DOWN_KEY;
    const ctrlDownKey = ctrlKey || metaKey;

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
      // If enter key is pressed and the input has a value
      if (target.value) {
        const value = this.input.value;
        const canAddItem = this._canAddItem(activeItems, value);

        // All is good, add
        if (canAddItem.response) {
          this.hideDropdown(true);
          this._addItem({
            value,
          });
          this._triggerChange(value);
          this.clearInput();
        }
      }

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

    const onDeleteKey = () => {
      // If backspace or delete key is pressed and the input has no value
      if (hasFocusedInput && !target.value) {
        this._handleBackspace(activeItems);
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
      [deleteKey]: onDeleteKey,
      [backKey]: onDeleteKey,
    };

    // If keycode has a function, run it
    if (keyDownActions[keyCode]) {
      keyDownActions[keyCode]();
    }
  }

  _onKeyUp({ target }) {
    if (target !== this.input.element) {
      return;
    }

    const value = this.input.value;
    const activeItems = this._store.activeItems;
    const canAddItem = this._canAddItem(activeItems, value);

    // We are typing into a text input and have a value, we want to show a dropdown
    // notice. Otherwise hide the dropdown
    if (value) {
      if (canAddItem.notice) {
        const dropdownItem = this._getTemplate('notice', canAddItem.notice);
        this.dropdown.element.innerHTML = dropdownItem.outerHTML;
      }

      if (canAddItem.response === true) {
        this.showDropdown(true);
      } else if (!canAddItem.notice) {
        this.hideDropdown(true);
      }
    } else {
      this.hideDropdown(true);
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
      // ...and we aren't dealing with a single select box, show dropdown/focus input

      const containerWasTarget =
        target === this.containerOuter.element ||
        target === this.containerInner.element;

      if (containerWasTarget) {
        // If text element, we only want to focus the input
        this.input.focus();
      }
      // Prevents focus event firing
      event.stopPropagation();
    }

    this._wasTap = true;
  }

  _onMouseDown(event) {
    const { target, shiftKey } = event;
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
    const hasShiftKey = shiftKey;

    const buttonTarget = findAncestorByAttrName(target, 'data-button');
    const itemTarget = findAncestorByAttrName(target, 'data-item');
    const choiceTarget = findAncestorByAttrName(target, 'data-choice');

    if (buttonTarget) {
      this._handleButtonAction(activeItems, buttonTarget);
    } else if (itemTarget) {
      this._handleItemAction(activeItems, itemTarget, hasShiftKey);
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
      if (
        !this.dropdown.isActive &&
        document.activeElement !== this.input.element
      ) {
        this.input.focus();
      }
    } else {
      const hasHighlightedItems = this._store.highlightedActiveItems;

      if (hasHighlightedItems) {
        this.unhighlightAll();
      }

      this.containerOuter.removeFocusState();
      this.hideDropdown(true);
    }
  }

  _onFocus({ target }) {
    if (target === this.input.element) {
      this.containerOuter.addFocusState();
    }
  }

  _onBlur({ target }) {
    if (
      this.containerOuter.element.contains(target) &&
      !this._isScrollingOnIe
    ) {
      const activeItems = this._store.activeItems;
      const hasHighlightedItems = activeItems.some(item => item.highlighted);

      if (target === this.input.element) {
        this.containerOuter.removeFocusState();
        if (hasHighlightedItems) {
          this.unhighlightAll();
        }
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
        'text',
      ),
      classNames: this.config.classNames,
      type: 'text',
      position: this.config.position,
    });

    this.containerInner = new Container({
      element: this._getTemplate('containerInner'),
      classNames: this.config.classNames,
      type: 'text',
      position: this.config.position,
    });

    this.input = new Input({
      element: this._getTemplate('input'),
      classNames: this.config.classNames,
      type: 'text',
    });

    this.choiceList = new List({
      element: this._getTemplate(
        'choiceList',
        false, // isSelectOneElement
      ),
    });

    this.itemList = new List({
      element: this._getTemplate(
        'itemList',
        false, // isSelectOneElement
      ),
    });

    this.dropdown = new Dropdown({
      element: this._getTemplate('dropdown'),
      classNames: this.config.classNames,
      type: 'text',
    });
  }

  _createStructure() {
    // Hide original element
    this.passedElement.conceal();
    // Wrap input in container preserving DOM ordering
    this.containerInner.wrap(this.passedElement.element);
    // Wrapper inner container with outer container
    this.containerOuter.wrap(this.containerInner.element);

    if (this._placeholderValue) {
      this.input.placeholder = this._placeholderValue;
      this.input.setWidth(true);
    }

    if (!this.config.addItems) {
      this.disable();
    }

    this.containerOuter.element.appendChild(this.containerInner.element);
    this.containerOuter.element.appendChild(this.dropdown.element);
    this.containerInner.element.appendChild(this.itemList.element);
    this.containerInner.element.appendChild(this.input.element);

    this._addPredefinedItems();
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

        this._addItem({
          value: item.value,
          label: item.label,
          choiceId: item.id,
          customProperties: item.customProperties,
          placeholder: item.placeholder,
        });
      },
      string: () => {
        this._addItem({ value: item });
      },
    };

    handleType[itemType]();
  }

  _generatePlaceholderValue() {
    return this.config.placeholder
      ? this.config.placeholderValue ||
          this.passedElement.element.getAttribute('placeholder')
      : false;
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
