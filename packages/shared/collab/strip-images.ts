/**
 * Image stripping for converting Annotation objects into RoomAnnotation.
 *
 * Uses a generic approach to avoid importing Annotation from @plannotator/ui.
 * Callers in packages/ui or packages/editor pass Annotation values; this
 * helper strips the images field.
 */

/** Strip the images field from an annotation-like object. */
export function toRoomAnnotation<T extends { images?: unknown }>(
  annotation: T,
): Omit<T, 'images'> {
  const { images: _, ...rest } = annotation;
  return rest;
}

/** Batch conversion. */
export function toRoomAnnotations<T extends { images?: unknown }>(
  annotations: T[],
): Omit<T, 'images'>[] {
  return annotations.map(toRoomAnnotation);
}
