# Philadelphia wall paintings

- Created: 2026-09-18.
- Asset: `philly-wall-art.png`, original generated 2:1 atlas. The room uses each half as a square painting, with the actual frames and mats built as Three.js geometry.
- Generation: built-in OpenAI image generation tool, with no input images. The generated output was copied unchanged into the project.
- Subjects: an interpretive Rocky statue/Philadelphia Museum of Art study and a Boathouse Row blue-hour study. These are decorative paintings, not documentary photographs or geographically exact views.
- The art loads only after entering the room; it is not part of the critical landing-page bundle.

## Generation prompt

Use case: stylized-concept. Asset type: original artwork texture atlas for two small framed oil paintings on the walls of a tasteful Philadelphia writing room. Create a single wide image exactly divided into TWO equal square paintings, edge-to-edge, without gutter, frames, mats, captions, typography or margins. The left square: a beautifully observed painterly study of Philadelphia's bronze Rocky statue, three-quarter rear/side view with both arms raised in victory, recognizable Art Museum steps and autumn trees receding in warm haze, the sculpture occupying the lower two-thirds, dignified and architectural, not a movie poster. The right square: Boathouse Row on the Schuylkill at blue hour, charming distinct Victorian rowing houses, delicate warm string lights tracing roofs and their broken reflections in dark navy water, autumn trees. Unified refined traditional oil painting aesthetic: small confident impasto brushstrokes, linen tooth, quiet depth, muted warm cream, weathered bronze, ochre, tobacco brown and deep blue-gray. Museum-quality intimate city studies, rich detail without harsh contrast, quiet and sophisticated. Straight-on orthographic capture of just the art; the generated file will be cut exactly at the center by texture UVs to display as two separate paintings. No rendered room, no wall, no frame, no border, no watermark. Aspect ratio 2:1, high detail.
