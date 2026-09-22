// Player inventory: stacks petals by typeId
// { typeId → count }
export const inventoryItems = {};

export let inventoryOpen = false;

export function addToInventory(typeId) {
  inventoryItems[typeId] = (inventoryItems[typeId] || 0) + 1;
}

export function removeFromInventory(typeId) {
  if (!inventoryItems[typeId]) return false;
  inventoryItems[typeId]--;
  if (inventoryItems[typeId] <= 0) delete inventoryItems[typeId];
  return true;
}

export function clearInventory() {
  for (const key of Object.keys(inventoryItems)) delete inventoryItems[key];
}

export function toggleInventory() { inventoryOpen = !inventoryOpen; }
export function openInventory()   { inventoryOpen = true;  }
export function closeInventory()  { inventoryOpen = false; }

// Inventory starts empty — 5 basics are pre-equipped in the hotbar
