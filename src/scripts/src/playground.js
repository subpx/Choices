import Fuse from 'fuse.js';
import Store from './store/store';
import Dropdown from './components/dropdown';
import Container from './components/container';
import Input from './components/input';
import List from './components/list';
import WrappedInput from './components/wrapped-input';
import WrappedSelect from './components/wrapped-select';
import { DEFAULT_CONFIG, DEFAULT_CLASSNAMES, EVENTS, KEY_CODES, SCROLLING_SPEED } from './constants';
import { TEMPLATES } from './templates';
import { addChoice, filterChoices, activateChoices, clearChoices } from './actions/choices';
import { addItem, removeItem, highlightItem } from './actions/items';
import { addGroup } from './actions/groups';
import { clearAll } from './actions/misc';
import {
  isScrolledIntoView,
  getAdjacentEl,
  getType,
  isType,
  isElement,
  strToEl,
  extend,
  sortByAlpha,
  sortByScore,
  generateId,
  findAncestorByAttrName,
  regexFilter,
} from './lib/utils';
import './lib/polyfills';

class Core {
  constructor(originalElement, userConfig) {
    if (!originalElement) {
      throw ReferenceError('No element passed to Choices');
    }

    const defaultConfig = {
      ...DEFAULT_CONFIG,
      items: [],
      choices: [],
      classNames: DEFAULT_CLASSNAMES,
      sortFn: sortByAlpha,
    };

    this.config = extend(defaultConfig, userConfig);

    this.initialised = false;
    this.currentState = {};
    this.prevState = {};
    this.wasTap = false;

    const originalElementType = getType('String', originalElement);

    if (originalElementType === 'text') {
      this.originalElement = new WrappedInput(originalElement);
    } else if (originalElementType.includes('select')) {
      this.originalElement = new WrappedSelect(originalElement);
    }

    this.render = this.render.bind(this);
    this.store = new Store(this.render);
  }

  init() {
    if (this.initialised) {
      return;
    }

    this.initialised = true;
    this.store.subscribe(this.render);
  }

  destroy() {
    if (!this.initialised) {
      return;
    }

    this.initialised = false;
    this.store.dispatch(clearAllAction());
  }

  render() {
    this.currentState = this.store.state;
  }

  _createTemplates() {
    // User's custom templates
    const callbackTemplate = this.config.callbackOnCreateTemplates;
    let userTemplates = {};
    if (callbackTemplate && isType('Function', callbackTemplate)) {
      userTemplates = callbackTemplate.call(this, strToEl);
    }

    this.config.templates = extend(TEMPLATES, userTemplates);
  }

  _createElements() {
    const direction = this.passedElement.element.getAttribute('dir') || 'ltr';
    const containerOuter = this._getTemplate('containerOuter',
      direction,
      this.isSelectElement,
      this.isSelectOneElement,
      this.config.searchEnabled,
      this.passedElement.element.type,
    );
    const containerInner = this._getTemplate('containerInner');
    const itemList = this._getTemplate('itemList', this.isSelectOneElement);
    const choiceList = this._getTemplate('choiceList', this.isSelectOneElement);
    const input = this._getTemplate('input');
    const dropdown = this._getTemplate('dropdown');

    this.containerOuter = new Container(this, containerOuter, this.config.classNames);
    this.containerInner = new Container(this, containerInner, this.config.classNames);
    this.input = new Input(this, input, this.config.classNames);
    this.choiceList = new List(this, choiceList, this.config.classNames);
    this.itemList = new List(this, itemList, this.config.classNames);
    this.dropdown = new Dropdown(this, dropdown, this.config.classNames);
  }

  _createStructure() {
    // Hide original element
    this.passedElement.conceal();
    // Wrap input in container preserving DOM ordering
    this.containerInner.wrap(this.passedElement.element);
    // Wrapper inner container with outer container
    this.containerOuter.wrap(this.containerInner.element);

    // @todo tidy this
    this.containerOuter.element.appendChild(this.containerInner.element);
    this.containerOuter.element.appendChild(this.dropdown.element);
    this.containerInner.element.appendChild(this.itemList.element);

    if (!this.config.addItems) {
      this.disable();
    }
  }

  _onBlur({ target }) {
    if (!this.containerOuter.element.contains(target) && this.isScrollingOnIe) {
      // On IE11, clicking the scollbar blurs our input and thus
      // closes the dropdown. To stop this, we refocus our input
      // if we know we are on IE *and* are scrolling.
      this.isScrollingOnIe = false;
      this.input.element.focus();
    }
  }

  _onClick({ target }) {
    const hasActiveDropdown = this.dropdown.isActive;
    const activeItems = this.store.activeItems;

    // If target is something that concerns us
    if (this.containerOuter.element.contains(target)) {
      if (!hasActiveDropdown) {
        if (this.isTextElement) {
          if (document.activeElement !== this.input.element) {
            this.input.focus();
          }
        } else if (this.canSearch) {
          this.showDropdown(true);
        } else {
          this.showDropdown();
          // code smell
          this.containerOuter.focus();
        }
      } else if (
        this.isSelectOneElement &&
        target !== this.input.element &&
        !this.dropdown.element.contains(target)
      ) {
        this.hideDropdown(true);
      }
    } else {
      const hasHighlightedItems = activeItems.some(item => item.highlighted);

      // De-select any highlighted items
      if (hasHighlightedItems) {
        this.unhighlightAll();
      }

      // Remove focus state
      this.containerOuter.removeFocusState();

      // Close all other dropdowns
      this.hideDropdown();
    }
  }

  _onMouseOver({ target }) {
    // If the dropdown is either the target or one of its children is the target
    const targetWithinDropdown = (
      target === this.dropdown || this.dropdown.element.contains(target)
    );
    const shouldHighlightChoice = targetWithinDropdown && target.hasAttribute('data-choice');

    if (shouldHighlightChoice) {
      this._highlightChoice(target);
    }
  }

  _onMouseDown(e) {
    const target = e.target;

    // If we have our mouse down on the scrollbar and are on IE11...
    if (target === this.choiceList && this.isIe11) {
      this.isScrollingOnIe = true;
    }

    if (this.containerOuter.element.contains(target) && target !== this.input.element) {
      const activeItems = this.store.activeItems;
      const hasShiftKey = e.shiftKey;

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

      e.preventDefault();
    }
  }

  _onTouchMove() {
    if (this.wasTap === true) {
      this.wasTap = false;
    }
  }

  _onKeyDown(e) {
    if (e.target !== this.input.element && !this.containerOuter.element.contains(e.target)) {
      return;
    }

    const target = e.target;
    const activeItems = this.store.activeItems;
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
    const ctrlDownKey = (e.ctrlKey || e.metaKey);

    this.canSearch = this.config.searchEnabled;

    const onAKey = () => {
      // If CTRL + A or CMD + A have been pressed and there are items to select
      if (ctrlDownKey && hasItems) {
        this.canSearch = false;
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
      if (this.isTextElement && target.value) {
        const value = this.input.value;
        const canAddItem = this._canAddItem(activeItems, value);

        // All is good, add
        if (canAddItem.response) {
          this.hideDropdown();
          this._addItem(value);
          this._triggerChange(value);
          this.clearInput();
        }
      }

      if (target.hasAttribute('data-button')) {
        this._handleButtonAction(activeItems, target);
        e.preventDefault();
      }

      if (hasActiveDropdown) {
        e.preventDefault();
        const highlighted = this.dropdown.getChild(`.${this.config.classNames.highlightedState}`);

        // If we have a highlighted choice
        if (highlighted) {
          // add enter keyCode value
          if (activeItems[0]) {
            activeItems[0].keyCode = enterKey;
          }
          this._handleChoiceAction(activeItems, highlighted);
        }
      } else if (this.isSelectOneElement) {
        // Open single select dropdown if it's not active
        this.showDropdown(true);
        e.preventDefault();
      }
    };

    const onEscapeKey = () => {
      if (hasActiveDropdown) {
        this.hideDropdown();
        this.containerOuter.focus();
      }
    };

    const onDirectionKey = () => {
      // If up or down key is pressed, traverse through options
      if (hasActiveDropdown || this.isSelectOneElement) {
        // Show dropdown if focus
        this.showDropdown(true);

        this.canSearch = false;

        const directionInt = e.keyCode === downKey || e.keyCode === pageDownKey ? 1 : -1;
        const skipKey = e.metaKey || e.keyCode === pageDownKey || e.keyCode === pageUpKey;

        let nextEl;
        if (skipKey) {
          if (directionInt > 0) {
            nextEl = Array.from(
              this.dropdown.element.querySelectorAll('[data-choice-selectable]'),
            ).pop();
          } else {
            nextEl = this.dropdown.element.querySelector('[data-choice-selectable]');
          }
        } else {
          const currentEl = this.dropdown.element.querySelector(
            `.${this.config.classNames.highlightedState}`,
          );
          if (currentEl) {
            nextEl = getAdjacentEl(currentEl, '[data-choice-selectable]', directionInt);
          } else {
            nextEl = this.dropdown.element.querySelector('[data-choice-selectable]');
          }
        }

        if (nextEl) {
          // We prevent default to stop the cursor moving
          // when pressing the arrow
          if (!isScrolledIntoView(nextEl, this.choiceList.element, directionInt)) {
            this._scrollToChoice(nextEl, directionInt);
          }
          this._highlightChoice(nextEl);
        }

        // Prevent default to maintain cursor position whilst
        // traversing dropdown options
        e.preventDefault();
      }
    };

    const onDeleteKey = () => {
      // If backspace or delete key is pressed and the input has no value
      if (hasFocusedInput && !e.target.value && !this.isSelectOneElement) {
        this._handleBackspace(activeItems);
        e.preventDefault();
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
    if (keyDownActions[e.keyCode]) {
      keyDownActions[e.keyCode]();
    }
  }
}

export class ChoicesInput extends Core {
  constructor(originalElement, userConfig) {
    super(originalElement, userConfig);

    if (originalElement.type !== 'text') {
      throw TypeError(`Invalid type of ${originalElement.type} given to Input`);
    }
  }

  _createStructure() {
    super._createStructure();
    this._addPredefinedItems();

    if (this.config.placeholder) {
      this.input.placeholder = this.placeholder;
      this.input.setWidth(true);
    }

    this.containerInner.element.appendChild(this.input.element);
  }

  _addPredefinedItems() {
    const handlePresetItem = (item) => {
      const itemType = getType(item);
      if (itemType === 'Object') {
        if (!item.value) {
          return;
        }
        this._addItem(
          item.value,
          item.label,
          item.id,
          undefined,
          item.customProperties,
          item.placeholder,
        );
      } else if (itemType === 'String') {
        this._addItem(item);
      }
    };

    this.presetItems.forEach(item => handlePresetItem(item));
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

    this.input.addEventListeners();
  }

  _onFocus({ target }) {
    if (this.containerOuter.element.contains(target)) {
      if (target === this.input.element) {
        this.containerOuter.addFocusState();
      }
    }
  }

  _onBlur({ target }) {
    super._onBlur({ target });

    if (this.containerOuter.element.contains(target) && !this.isScrollingOnIe) {
      const hasHighlightedItems = this.store.highlightedActiveItems.length;

      if (target === this.input.element) {
        // Remove the focus state
        this.containerOuter.removeFocusState();
        // De-select any highlighted items
        if (hasHighlightedItems) {
          this.unhighlightAll();
        }

        this.hideDropdown();
      }
    }
  }

  _onKeyUp({ target }) {
    if (target !== this.input.element) {
      return;
    }

    const value = this.input.value;
    const activeItems = this.store.activeItems;
    const canAddItem = this._canAddItem(activeItems, value);

    if (value) {
      if (canAddItem.notice) {
        const dropdownItem = this._getTemplate('notice', canAddItem.notice);
        this.dropdown.element.innerHTML = dropdownItem.outerHTML;
      }

      if (canAddItem.response === true) {
        this.showDropdown();
      } else if (!canAddItem.notice) {
        this.hideDropdown();
      }
    } else {
      this.hideDropdown();
    }
  }

  _onTouchEnd(e) {
    const target = (e.target || e.touches[0].target);

    if (this.wasTap === true && this.containerOuter.element.contains(target)) {
      if (target === this.containerOuter.element || target === this.containerInner.element) {
        this.input.focus();
      }

      e.stopPropagation();
    }

    this.wasTap = true;
  }
}

class ChoicesSelect extends Core {
  _createStructure() {
    super._createStructure();
    this._addPredefinedChoices();

    this.dropdown.element.appendChild(this.choiceList.element);
  }

  _addPredefinedChoices() {
    const passedGroups = this.passedElement.optionGroups;

    this.highlightPosition = 0;
    this.isSearching = false;

    if (passedGroups && passedGroups.length) {
      // If we have a placeholder option
      const placeholderChoice = this.passedElement.placeholderOption;
      if (placeholderChoice && placeholderChoice.parentNode.tagName === 'SELECT') {
        this._addChoice(
          placeholderChoice.value,
          placeholderChoice.innerHTML,
          placeholderChoice.selected,
          placeholderChoice.disabled,
          undefined,
          undefined,
          true, /* placeholder */
        );
      }

      passedGroups.forEach((group) => {
        this._addGroup(group, (group.id || null));
      });
    } else {
      const passedOptions = this.passedElement.options;
      const filter = this.config.sortFn;
      const allChoices = this.presetChoices;

      // Create array of options from option elements
      passedOptions.forEach((o) => {
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
        if (this.isSelectElement) {
          // If the choice is actually a group
          if (choice.choices) {
            this._addGroup(choice, choice.id || null);
          } else {
            // If there is a selected choice already or the choice is not
            // the first in the array, add each choice normally
            // Otherwise pre-select the first choice in the array if it's a single select
            const shouldPreselect = this.isSelectOneElement && !hasSelectedChoice && index === 0;
            const isSelected = shouldPreselect ? true : choice.selected;
            const isDisabled = shouldPreselect ? false : choice.disabled;

            this._addChoice(
              choice.value,
              choice.label,
              isSelected,
              isDisabled,
              undefined,
              choice.customProperties,
              choice.placeholder,
            );
          }
        } else {
          this._addChoice(
            choice.value,
            choice.label,
            choice.selected,
            choice.disabled,
            undefined,
            choice.customProperties,
            choice.placeholder,
          );
        }
      };

      // Add each choice
      allChoices.forEach((choice, index) => handleChoice(choice, index));
    }
  }

  _onKeyUp({ target, keyCode }) {
    if (target !== this.input.element) {
      return;
    }

    const value = this.input.value;
    const activeItems = this.store.activeItems;
    const canAddItem = this._canAddItem(activeItems, value);
    const acceptedKeys = [KEY_CODES.BACK_KEY, KEY_CODES.DELETE_KEY];

    // If user has removed value...
    if (acceptedKeys.includes(keyCode) && !target.value) {
      // ...and it is a multiple select input, activate choices (if searching)
      if (!this.isTextElement && this.isSearching) {
        this.isSearching = false;
        this.store.dispatch(activateChoices(true));
      }
    } else if (this.canSearch && canAddItem.response) {
      this._handleSearch(this.input.value);
    }

    // Re-establish canSearch value from changes in _onKeyDown
    this.canSearch = this.config.searchEnabled;
  }

  _onKeyDown(e) {
    super._onKeyDown(e);

    const keyString = String.fromCharCode(e.keyCode);
    // If a user is typing and the dropdown is not active
    if (/[a-zA-Z0-9-_ ]/.test(keyString)) {
      this.showDropdown(true);
    }
  }
}

export class ChoicesSelectOne extends ChoicesSelect {
  constructor(originalElement, userConfig) {
    super(originalElement, userConfig);

    if (originalElement.type !== 'select-one') {
      throw TypeError(`Invalid type of ${originalElement.type} given to Input`);
    }
  }

  _createStructure() {
    super._createStructure();

    if (this.config.searchEnabled) {
      this.dropdown.element.insertBefore(this.input.element, this.dropdown.element.firstChild);
    }

    // @todo put this somewhere else
    this.input.placeholder = (this.config.searchPlaceholderValue || '');
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

    this.input.addEventListeners();
  }

  _onFocus({ target }) {
    if (this.containerOuter.element.contains(target)) {
      super._onFocus({ target });

      this.containerOuter.addFocusState();

      if (target === this.input.element) {
        this.showDropdown();
      }
    }
  }

  _onBlur({ target }) {
    super._onBlur({ target });

    // If target is something that concerns us
    if (this.containerOuter.element.contains(target) && !this.isScrollingOnIe) {
      this.containerOuter.removeFocusState();
      if (target === this.input.element ||
                  (target === this.containerOuter.element && !this.canSearch)) {
        this.hideDropdown();
      }
    }
  }

  _onTouchEnd(e) {
    const target = (e.target || e.touches[0].target);

    // If a user tapped within our container...
    if (this.wasTap === true && this.containerOuter.element.contains(target)) {
      // Prevents focus event firing
      e.stopPropagation();
    }

    this.wasTap = true;
  }
}

export class ChoicesSelectMultiple extends ChoicesSelect {
  constructor(originalElement) {
    super(originalElement);

    if (originalElement.type !== 'select-multiple') {
      throw TypeError(`Invalid type of ${originalElement.type} given to Input`);
    }
  }

  _createStructure() {
    super._createStructure();

    // @todo put this somewhere else
    if (this.config.placeholder) {
      this.input.placeholder = this.placeholder;
      this.input.setWidth(true);
    }

    // @todo tidy
    this.containerInner.element.appendChild(this.input.element);
  }

  _onFocus({ target }) {
    if (this.containerOuter.element.contains(target)) {
      super._onFocus({ target });

      if (target === this.input.element) {
        this.containerOuter.addFocusState();
        this.showDropdown(true);
      }
    }
  }

  _onBlur({ target }) {
    super._onBlur({ target });

    // If target is something that concerns us
    if (this.containerOuter.element.contains(target) && !this.isScrollingOnIe) {
      const hasHighlightedItems = this.store.highlightedActiveItems.length;

      if (target === this.input.element) {
        // Remove the focus state
        this.containerOuter.removeFocusState();
        this.hideDropdown();
        // De-select any highlighted items
        if (hasHighlightedItems) {
          this.unhighlightAll();
        }
      }
    }
  }

  _onTouchEnd(e) {
    const target = (e.target || e.touches[0].target);

    if (this.wasTap === true && this.containerOuter.element.contains(target)) {
      if (target === this.containerOuter.element || target === this.containerInner.element) {
        this.showDropdown(true);
      }

      e.stopPropagation();
    }

    this.wasTap = true;
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

    this.input.addEventListeners();
  }
}
