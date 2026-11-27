![A local picture drawn behind the translucent interface, with the layout and look controls in a floating panel](preview.svg)

Whole window, or split with separate images for the content area and the left sidebar. Each layer
has its own cropper — drag to frame it, scroll to zoom, and the preview frame is exactly what lands.
No more fixed fit / position / zoom presets. Framing is stored in **image coordinates** (an anchor plus
the target box in pixels), so enlarging the window, going fullscreen or collapsing the sidebar never
drags the picture sideways; the fixed-width sidebar column defaults to "lock framing", where a taller
window only reveals more and the extra space is filled with a blurred copy instead of re-zooming the shot. Each layer also keeps its own blur, media opacity,
brightness, saturation and contrast: click a media card to switch which layer the sliders edit, so
there is still only one set of sliders, and one "Copy look to ..." button pushes the whole set to the
other layer in split mode. There is a single fade control — each layer's media opacity — and blur runs
as a `backdrop-filter` overlay while the media element keeps filling the viewport, so dragging blur
never enlarges the picture. Media is uploaded only —
no local-path input cluttering the panel. The panel is frosted glass, and the corner button is the
plugin's own whale-chef avatar. Both light and dark shells follow the host's colour tokens, so
switching theme needs no re-setup; the panel, sliders, switch and cropper are contrast-checked in dark.
