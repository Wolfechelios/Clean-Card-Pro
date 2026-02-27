import create from 'zustand';

export const useCollectionStore = create((set) => ({
  cards: [],
  addCard: (card) => set((state) => ({ cards: [...state.cards, card] }))
}));