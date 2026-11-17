// Shared rule constants for Azul. Colors are referenced by index everywhere in
// the engine so that boards can be stored as small integer arrays.

export const COLORS = ['blue', 'yellow', 'red', 'black', 'white'];
export const COLOR_COUNT = COLORS.length;
export const TILES_PER_COLOR = 20;
export const WALL_SIZE = 5;
export const FACTORY_CAPACITY = 4;
export const FLOOR_PENALTIES = [-1, -1, -2, -2, -2, -3, -3];
export const FACTORIES_BY_PLAYERS = { 2: 5, 3: 7, 4: 9 };

export const FIRST_PLAYER_TOKEN = 'first';

export const BONUS_ROW = 2;
export const BONUS_COLUMN = 7;
export const BONUS_COLOR = 10;

/** Column on the wall where `color` must go in `row` (standard Azul pattern). */
export function wallColumnFor(row, color) {
  return (row + color) % WALL_SIZE;
}

/** Which color belongs at wall position (row, col). */
export function wallColorAt(row, col) {
  return (col - row + WALL_SIZE) % WALL_SIZE;
}
