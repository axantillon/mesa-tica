# Mesa Tica

Pickup ordering for one restaurant. Guests browse the menu, place an order and follow its progress through a private link. Restaurant staff manage a shared queue and mark orders Preparing, Ready, Collected or Cancelled. Customers pay at collection.

## Product documents

1. [Specification](context/product-specification.md): scope, business rules and complete workflows.
2. [Audience and scenarios](context/audience.md): customer and employee needs.
3. [User stories](context/user-stories.md): the eleven ordering, staff and tracking stories.
4. [Restaurant and menu](context/restaurant-and-menu.md): sample identity, local hours, pickup information and prices.
5. [Experience](context/experience.md): screen responsibilities, states, actions and wording.
6. [Product models](design/README.md): context, logical architecture, detailed classes, lifecycle, eleven story sequences and a setup sequence.
7. [Acceptance criteria](context/acceptance.md) and [traceability](design/traceability.md): observable outcomes and quality targets.

[KICKOFF.md](KICKOFF.md) is the implementation prompt, including documentation, milestone commits and draft-PR progress when GitHub access is available. The documents define product behavior and logical software design. Concrete technology, framework-native code organization, storage mechanisms and visual execution are implementation choices.

The specification governs business rules; the restaurant/menu document supplies concrete content. Stories and experience guidance explain the product. The architecture, detailed design and sequences define the logical responsibilities that realize it. In a minor ambiguity, preserve the specification's behavior and make a practical choice. Quality targets require measurement and are not a prerequisite for beginning implementation.

Rendered design: [diagram gallery](design/diagram-gallery.md) · [detailed class views](design/class-views.md).
