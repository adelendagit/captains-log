const list = document.getElementById("todo-list");
const count = document.getElementById("todo-count");
const empty = document.getElementById("todo-empty");
const status = document.getElementById("todo-status");

function updateCount() {
  const remaining = list.querySelectorAll(".todo-card").length;
  count.textContent = `${remaining} open`;
  empty.hidden = remaining !== 0;
}

list.addEventListener("click", async (event) => {
  const button = event.target.closest(".done-button");
  if (!button) return;

  const card = button.closest(".todo-card");
  const cardId = card.dataset.cardId;
  button.disabled = true;
  button.textContent = "Marking…";
  status.textContent = "";

  try {
    const response = await fetch(`/to-do/${encodeURIComponent(cardId)}/done`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Unable to mark this card as done.");
    }

    card.remove();
    updateCount();
    status.textContent = "Card marked as done.";
  } catch (error) {
    button.disabled = false;
    button.textContent = "Mark done";
    status.textContent = error.message;
  }
});
