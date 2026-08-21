const express = require("express");
const multer = require("multer");
const {
  DEFAULT_LIST_ID,
  addTodoCardAttachment,
  archiveTodoCard,
  createTodoCard,
  defaultTodoLists,
  downloadTodoCardAttachment,
  fetchBoardLists,
  fetchTodoCards,
  reorderTodoCards,
  setTodoCardCompletion,
  updateTodoCard,
} = require("../services/todo");
const { getTodoListIds, setTodoListIds } = require("../services/todoSettings");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

async function getAvailableLists(user) {
  if (!user) return [{ id: DEFAULT_LIST_ID, name: "To-do" }];
  const boardLists = await fetchBoardLists();
  const configuredIds = await getTodoListIds();
  return selectAvailableLists(boardLists, configuredIds);
}

function selectAvailableLists(boardLists, configuredIds) {
  if (!configuredIds) return defaultTodoLists(boardLists);
  const configuredIdSet = new Set(configuredIds);
  return boardLists.filter((list) => configuredIdSet.has(list.id));
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
      user: req.user,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/api/data", async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const lists = await getAvailableLists(req.user);
    const payload = await Promise.all(
      lists.map(async (list) => ({
        ...list,
        cards: await fetchTodoCards(list.id),
      })),
    );
    res.set("Cache-Control", "no-store");
    res.json({ lists: payload });
  } catch (error) {
    next(error);
  }
});

router.get("/api/settings", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const [boardLists, configuredIds] = await Promise.all([
      fetchBoardLists(),
      getTodoListIds(),
    ]);
    const lists = selectAvailableLists(boardLists, configuredIds);
    res.set("Cache-Control", "no-store");
    res.json({
      lists: boardLists,
      selectedListIds: lists.map((list) => list.id),
    });
  } catch (error) {
    next(error);
  }
});

router.put("/api/settings", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(403).json({ error: "Not authenticated" });
      return;
    }
    const listIds = req.body.listIds;
    if (
      !Array.isArray(listIds) ||
      listIds.length === 0 ||
      listIds.some((listId) => typeof listId !== "string") ||
      new Set(listIds).size !== listIds.length
    ) {
      res.status(400).json({ error: "Select at least one unique to-do list" });
      return;
    }
    const boardLists = await fetchBoardLists();
    const boardListIds = new Set(boardLists.map((list) => list.id));
    if (listIds.some((listId) => !boardListIds.has(listId))) {
      res
        .status(400)
        .json({ error: "One or more selected lists are unavailable" });
      return;
    }
    const selectedListIds = boardLists
      .filter((list) => listIds.includes(list.id))
      .map((list) => list.id);
    await setTodoListIds(selectedListIds);
    res.json({ success: true, selectedListIds });
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

router.patch("/:cardId", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(403).json({ error: "Not authenticated" });
      return;
    }

    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const desc = typeof req.body.desc === "string" ? req.body.desc.trim() : "";
    if (!name || name.length > 512) {
      res
        .status(400)
        .json({ error: "Item name must be between 1 and 512 characters" });
      return;
    }
    if (desc.length > 16384) {
      res
        .status(400)
        .json({ error: "Item description must be 16,384 characters or fewer" });
      return;
    }

    const lists = await getAvailableLists(req.user);
    await updateTodoCard(
      req.params.cardId,
      name,
      desc,
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

router.post("/:cardId/archive", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(403).json({ error: "Not authenticated" });
      return;
    }

    const lists = await getAvailableLists(req.user);
    await archiveTodoCard(
      req.params.cardId,
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

router.post(
  "/:cardId/attachments",
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.user) {
        res.status(403).json({ error: "Not authenticated" });
        return;
      }
      if (!req.file || !req.file.mimetype.startsWith("image/")) {
        res.status(400).json({ error: "An image file is required" });
        return;
      }

      const lists = await getAvailableLists(req.user);
      const attachment = await addTodoCardAttachment(
        req.params.cardId,
        {
          buffer: req.file.buffer,
          filename: req.file.originalname || "todo-photo.jpg",
          mimeType: req.file.mimetype,
        },
        lists.map((list) => list.id),
      );
      res.status(201).json({ success: true, attachment });
    } catch (error) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    }
  },
);

router.get(
  "/:cardId/attachments/:attachmentId/image",
  async (req, res, next) => {
    try {
      if (!req.user) {
        res.status(403).json({ error: "Not authenticated" });
        return;
      }
      const lists = await getAvailableLists(req.user);
      const attachment = await downloadTodoCardAttachment(
        req.params.cardId,
        req.params.attachmentId,
        lists.map((list) => list.id),
      );
      res.set("Cache-Control", "private, max-age=3600");
      res.type(attachment.mimeType || "application/octet-stream");
      res.send(attachment.data);
    } catch (error) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    }
  },
);

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
