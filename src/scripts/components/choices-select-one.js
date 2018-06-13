import Store from '../store/store';
import { Dropdown, Container, Input, List } from '../components';
import ChoicesSelect from './choices-select';
import { KEY_CODES } from '../constants';
import { activateChoices } from '../actions/choices';
import {
  isScrolledIntoView,
  getAdjacentEl,
  isType,
  sortByScore,
  findAncestorByAttrName,
  isIE11,
  cloneObject,
} from '../lib/utils';

/**
 * ChoicesSelectOne
 * @author Josh Johnson<josh@joshuajohnson.co.uk>
 */
export default class ChoicesSelectOne extends ChoicesSelect {
  constructor(element, config) {
    super(element, config);

    if (this.config.shouldSortItems === true) {
      if (!this.config.silent) {
        console.warn(
          "shouldSortElements: Type of passed element is 'select-one', falling back to false.",
        );
      }

      this.config.shouldSortItems === false;
    }

    this._store = new Store(this.render);

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

  _handleButtonAction(activeItems, element) {
    if (
      !activeItems ||
      !element ||
      !this.config.removeItems ||
      !this.config.removeItemButton
    ) {
      return;
    }

    super._handleButtonAction(activeItems, element);

    this._selectPlaceholderChoice();
  }

  _handleChoiceAction(activeItems, element) {
    super._handleChoiceAction(activeItems, element);

    // We wont to close the dropdown if we are dealing with a single select box
    if (this.dropdown.isActive) {
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
      placeholderItem.innerHTML = '';
    }
  }

  _canAddItem(value) {
    const canAddItem = true;
    const notice = isType('Function', this.config.addItemText)
      ? this.config.addItemText(value)
      : this.config.addItemText;

    return {
      response: canAddItem,
      notice,
    };
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

  destroy() {
    super.destroy();

    if (this.initialised) {
      this._removeEventListeners();
    }
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
    const {
      ENTER_KEY: enterKey,
      A_KEY: aKey,
      ESC_KEY: escapeKey,
      UP_KEY: upKey,
      DOWN_KEY: downKey,
      PAGE_UP_KEY: pageUpKey,
      PAGE_DOWN_KEY: pageDownKey,
    } = KEY_CODES;
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
    const canAddItem = this._canAddItem(value);
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

    if (this.config.searchEnabled) {
      this.dropdown.element.insertBefore(
        this.input.element,
        this.dropdown.element.firstChild,
      );
    }

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
      const canAddItem = this._canAddItem(this.input.value);

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
}
