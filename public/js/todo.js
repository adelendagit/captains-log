const page = document.querySelector(".todo-page");
const openList = document.getElementById("todo-list");
const doneList = document.getElementById("done-list");
const openCount = document.getElementById("todo-count");
const doneCount = document.getElementById("done-count");
const openEmpty = document.getElementById("todo-empty");
const doneEmpty = document.getElementById("done-empty");
const statusMessage = document.getElementById("todo-status");
const doneSection = document.querySelector(".done-section");
const addItemForm = document.getElementById("add-item-form");
const addItemMatches = document.getElementById("add-item-matches");
const settingsButton = document.getElementById("todo-settings-button");
const settingsDialog = document.getElementById("todo-settings-dialog");
const settingsForm = document.getElementById("todo-settings-form");
const userMenuButton = document.getElementById("user-menu-btn");
const userDropdown = document.getElementById("user-dropdown");

if (userMenuButton && userDropdown) {
  userMenuButton.addEventListener("click", (event) => {
    event.preventDefault();
    userDropdown.style.display =
      userDropdown.style.display === "block" ? "none" : "block";
  });
  document.addEventListener("click", (event) => {
    if (
      !userMenuButton.contains(event.target) &&
      !userDropdown.contains(event.target)
    ) {
      userDropdown.style.display = "none";
    }
  });
}

function updateCounts() {
  const open = openList.querySelectorAll(".todo-card").length;
  const done = doneList.querySelectorAll(".todo-card").length;
  openCount.textContent = `${open} open`;
  doneCount.textContent = done;
  openEmpty.hidden = open !== 0;
  doneEmpty.hidden = done !== 0;
}

function insertByTrelloPosition(container, card) {
  const position = Number(card.dataset.cardPos);
  const nextCard = Array.from(container.querySelectorAll(".todo-card")).find(
    (candidate) => Number(candidate.dataset.cardPos) > position,
  );
  container.insertBefore(card, nextCard || null);
}

async function setCompletion(card, complete) {
  const checkbox = card.querySelector(".done-checkbox");
  checkbox.disabled = true;
  statusMessage.textContent = complete
    ? "Marking item as done…"
    : "Restoring item…";

  try {
    const response = await fetch(
      `/to-do/${encodeURIComponent(card.dataset.cardId)}/completion`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complete }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Unable to update this card.");
    }

    card.classList.toggle("is-done", complete);
    checkbox.setAttribute(
      "aria-label",
      complete ? "Mark item as not done" : "Mark item as done",
    );
    insertByTrelloPosition(complete ? doneList : openList, card);
    if (complete) doneSection.open = true;
    checkbox.disabled = false;
    updateCounts();
    statusMessage.textContent = complete
      ? "Item marked as done."
      : "Item restored.";
    return true;
  } catch (error) {
    checkbox.checked = !complete;
    checkbox.disabled = false;
    statusMessage.textContent = error.message;
    return false;
  }
}

function normalized(value) {
  return value.trim().toLocaleLowerCase();
}

function matchingCards(query) {
  if (!query) return [];
  return Array.from(page.querySelectorAll(".todo-card"))
    .filter((card) => normalized(card.dataset.cardName).includes(query))
    .sort((left, right) => {
      const leftExact = normalized(left.dataset.cardName) === query;
      const rightExact = normalized(right.dataset.cardName) === query;
      if (leftExact !== rightExact) return leftExact ? -1 : 1;
      if (
        left.classList.contains("is-done") !==
        right.classList.contains("is-done")
      ) {
        return left.classList.contains("is-done") ? 1 : -1;
      }
      return left.dataset.cardName.localeCompare(right.dataset.cardName);
    })
    .slice(0, 8);
}

function renderMatches(input) {
  if (!addItemMatches) return;
  const query = normalized(input.value);
  const matches = matchingCards(query);
  addItemMatches.replaceChildren();
  addItemMatches.hidden = matches.length === 0;
  if (!matches.length) return;

  for (const card of matches) {
    const complete = card.classList.contains("is-done");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "add-item-match";
    const name = document.createElement("span");
    name.textContent = card.dataset.cardName;
    const action = document.createElement("span");
    action.className = "add-item-match-action";
    action.textContent = complete ? "Restore" : "Already open";
    button.append(name, action);
    button.disabled = !complete;
    if (complete) {
      button.addEventListener("click", async () => {
        if (await setCompletion(card, false)) {
          input.value = "";
          renderMatches(input);
          input.focus();
        }
      });
    }
    addItemMatches.appendChild(button);
  }
}

page.addEventListener("change", (event) => {
  const checkbox = event.target.closest(".done-checkbox");
  if (!checkbox) return;
  setCompletion(checkbox.closest(".todo-card"), checkbox.checked);
});

if (addItemForm) {
  const input = addItemForm.querySelector("input[name='name']");
  input.addEventListener("input", () => renderMatches(input));
  input.addEventListener("focus", () => renderMatches(input));
  addItemForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = addItemForm.querySelector("button[type='submit']");
    const name = input.value.trim();
    if (!name) return;

    const exactMatch = matchingCards(normalized(name)).find(
      (card) => normalized(card.dataset.cardName) === normalized(name),
    );
    if (exactMatch) {
      if (exactMatch.classList.contains("is-done")) {
        if (await setCompletion(exactMatch, false)) {
          input.value = "";
          renderMatches(input);
        }
      } else {
        statusMessage.textContent = "That item is already open.";
      }
      return;
    }

    input.disabled = true;
    button.disabled = true;
    statusMessage.textContent = "Adding item…";

    try {
      const response = await fetch("/to-do/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId: page.dataset.listId, name }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Unable to add the item.");
      }
      window.location.reload();
    } catch (error) {
      input.disabled = false;
      button.disabled = false;
      input.focus();
      statusMessage.textContent = error.message;
    }
  });
}

if (settingsButton && settingsDialog && settingsForm) {
  const listsContainer = document.getElementById("todo-settings-lists");
  const settingsStatus = document.getElementById("todo-settings-status");
  const closeSettings = () => settingsDialog.close();
  document
    .getElementById("todo-settings-close")
    .addEventListener("click", closeSettings);
  document
    .getElementById("todo-settings-cancel")
    .addEventListener("click", closeSettings);

  settingsButton.addEventListener("click", async () => {
    settingsDialog.showModal();
    settingsStatus.textContent = "";
    listsContainer.innerHTML = "<p>Loading lists…</p>";
    try {
      const response = await fetch("/to-do/api/settings");
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to load lists.");
      const selected = new Set(result.selectedListIds);
      listsContainer.replaceChildren();
      for (const board of result.boards) {
        const group = document.createElement("fieldset");
        group.className = "todo-settings-board";
        const legend = document.createElement("legend");
        legend.textContent = board.name;
        group.appendChild(legend);

        for (const list of board.lists) {
          const label = document.createElement("label");
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.name = "listId";
          checkbox.value = list.id;
          checkbox.checked = selected.has(list.id);
          const name = document.createElement("span");
          name.textContent = list.name;
          label.append(checkbox, name);
          group.appendChild(label);
        }
        listsContainer.appendChild(group);
      }
    } catch (error) {
      listsContainer.replaceChildren();
      settingsStatus.textContent = error.message;
    }
  });

  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const listIds = Array.from(
      settingsForm.querySelectorAll("input[name='listId']:checked"),
      (checkbox) => checkbox.value,
    );
    if (!listIds.length) {
      settingsStatus.textContent = "Select at least one list.";
      return;
    }
    const saveButton = settingsForm.querySelector("button[type='submit']");
    saveButton.disabled = true;
    settingsStatus.textContent = "Saving…";
    try {
      const response = await fetch("/to-do/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listIds }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to save lists.");
      window.location.reload();
    } catch (error) {
      saveButton.disabled = false;
      settingsStatus.textContent = error.message;
    }
  });
}

if (window.Sortable) {
  let previousOrder = [];
  Sortable.create(openList, {
    animation: 160,
    dataIdAttr: "data-card-id",
    draggable: ".todo-card",
    ghostClass: "todo-card-ghost",
    handle: ".drag-handle",
    onStart(event) {
      previousOrder = Array.from(
        event.from.querySelectorAll(".todo-card"),
        (card) => card.dataset.cardId,
      );
    },
    async onEnd() {
      const cardIds = Array.from(
        openList.querySelectorAll(".todo-card"),
        (card) => card.dataset.cardId,
      );
      if (cardIds.join() === previousOrder.join()) return;

      statusMessage.textContent = "Saving order…";
      try {
        const response = await fetch("/to-do/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listId: page.dataset.listId, cardIds }),
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Unable to save the new order.");
        }
        Array.from(openList.querySelectorAll(".todo-card")).forEach(
          (card, index) => {
            card.dataset.cardPos = String((index + 1) * 16384);
          },
        );
        statusMessage.textContent = "Order saved.";
      } catch (error) {
        const cardsById = new Map(
          Array.from(openList.querySelectorAll(".todo-card"), (card) => [
            card.dataset.cardId,
            card,
          ]),
        );
        previousOrder.forEach((cardId) => {
          const card = cardsById.get(cardId);
          if (card) openList.appendChild(card);
        });
        statusMessage.textContent = error.message;
      }
    },
  });
}
