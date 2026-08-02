const express = require("express");
const {
  DEFAULT_LIST_ID,
  createTodoCard,
  fetchTodoCards,
  fetchTodoLists,
  reorderTodoCards,
  setTodoCardCompletion,
} = require("../services/todo");

const router = express.Router();

async function getAvailableLists(user) {
  if (!user) return [{ id: DEFAULT_LIST_ID, name: "To-do" }];
  return fetchTodoLists();
}

router.get("/", async (req, res, next) => {
  try {
    const lists = await getAvailableLists(req.user);
    const requestedListId =
      typeof req.query.list === "string" ? req.query.list : null;
    const selectedList =
      lists.find((list) => list.id === requestedListId) ||
      lists.find((list) => list.id === DEFAULT_LIST_ID) ||
      lists[0];

    if (!selectedList) {
      res.status(404).send("No to-do lists are available");
      return;
    }

    const cards = await fetchTodoCards(selectedList.id);
    res.set("Cache-Control", "no-store");
    res.render("todo", {
      openCards: cards.filter((card) => !card.dueComplete),
      doneCards: cards.filter((card) => card.dueComplete),
      lists,
      selectedList,
      showListSwitcher: Boolean(req.user),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/items", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(403).json({ error: "Not authenticated" });
      return;
    }

    const listId = typeof req.body.listId === "string" ? req.body.listId : "";
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 512) {
      res
        .status(400)
        .json({ error: "Item name must be between 1 and 512 characters" });
      return;
    }

    const lists = await getAvailableLists(req.user);
    if (!lists.some((list) => list.id === listId)) {
      res.status(404).json({ error: "To-do list not found" });
      return;
    }

    const card = await createTodoCard(listId, name);
    res.status(201).json({ success: true, cardId: card.id });
  } catch (error) {
    next(error);
  }
});

router.post("/:cardId/completion", async (req, res, next) => {
  try {
    if (typeof req.body.complete !== "boolean") {
      res.status(400).json({ error: "complete must be a boolean" });
      return;
    }

    const lists = await getAvailableLists(req.user);
    await setTodoCardCompletion(
      req.params.cardId,
      req.body.complete,
      lists.map((list) => list.id),
    );
    res.json({ success: true });
  } catch (error) {
    if (error.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    next(error);
  }
});

router.post("/reorder", async (req, res, next) => {
  try {
    const { listId, cardIds } = req.body;
    if (typeof listId !== "string" || !Array.isArray(cardIds)) {
      res.status(400).json({ error: "listId and cardIds are required" });
      return;
    }

    const lists = await getAvailableLists(req.user);
    if (!lists.some((list) => list.id === listId)) {
      res.status(404).json({ error: "To-do list not found" });
      return;
    }

    await reorderTodoCards(listId, cardIds);
    res.json({ success: true });
  } catch (error) {
    if (error.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    next(error);
  }
});

module.exports = router;
