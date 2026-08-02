const page = document.querySelector(".todo-page");
const openList = document.getElementById("todo-list");
const doneList = document.getElementById("done-list");
const openCount = document.getElementById("todo-count");
const doneCount = document.getElementById("done-count");
const openEmpty = document.getElementById("todo-empty");
const doneEmpty = document.getElementById("done-empty");
const status = document.getElementById("todo-status");
const doneSection = document.querySelector(".done-section");
const addItemForm = document.getElementById("add-item-form");
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
  status.textContent = complete ? "Marking item as done…" : "Restoring item…";

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
    status.textContent = complete ? "Item marked as done." : "Item restored.";
  } catch (error) {
    checkbox.checked = !complete;
    checkbox.disabled = false;
    status.textContent = error.message;
  }
}

page.addEventListener("change", (event) => {
  const checkbox = event.target.closest(".done-checkbox");
  if (!checkbox) return;
  setCompletion(checkbox.closest(".todo-card"), checkbox.checked);
});

if (addItemForm) {
  addItemForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = addItemForm.querySelector("input[name='name']");
    const button = addItemForm.querySelector("button[type='submit']");
    const name = input.value.trim();
    if (!name) return;

    input.disabled = true;
    button.disabled = true;
    status.textContent = "Adding item…";

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
      status.textContent = error.message;
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
    async onEnd(event) {
      const cardIds = Array.from(
        openList.querySelectorAll(".todo-card"),
        (card) => card.dataset.cardId,
      );
      if (cardIds.join() === previousOrder.join()) return;

      status.textContent = "Saving order…";
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
        status.textContent = "Order saved.";
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
        status.textContent = error.message;
      }
    },
  });
}
