1. **Layering & Z-Index**:
   - Add `focus-within:z-40 active:z-50 hover:z-10` to the pane wrapper `div`. This ensures that when the user clicks or resizes a panel, it pops to the top layer.
2. **Cursor Behavior**:
   - Remove `cursor-grab` and `active:cursor-grabbing` from the normal hover state in `FolderTree.tsx`. We will only apply the grabbing cursor when the `draggedPaneKey` is active or natively rely on the browser's drag cursor.
3. **Targeting (Folder Tree)**:
   - In `FolderTree.tsx`, add `e.stopPropagation()` to `onDragOver`, `onDragEnter`, and `onDrop`. This ensures that only the deepest hovered folder gets the blue drop-zone highlight, preventing the entire shelf from lighting up.
4. **Tab Swapping Re-render**:
   - In `RoomShell.tsx`, instead of swapping `room.pdf` (which causes `PDFViewer` to remount with a new file), we will introduce a purely visual `paneOrder: string[]` state.
   - When dropping a pane, we update `paneOrder` to swap their positions.
   - `allPanes` will be sorted according to `paneOrder` before rendering. This preserves React keys and prevents any PDF reloading, making the swap instant.
5. **Resize Handles**:
   - Native `resize: both` only provides a tiny bottom-right handle. We will add a small custom resize hook or invisible edge/corner divs to allow resizing from bottom, right, and bottom-right edges, updating the inline `width`/`height` of the pane wrapper.
