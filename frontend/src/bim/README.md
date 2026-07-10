Overview of BIM models and manager.

This folder contains object-oriented BIM element models, a manager and helpers.

Design goals:
- Each element is a class with parameters and methods
- Geometry is produced from parameters (no direct Mesh creation outside factories)
- Elements emit events when params change
- Manager holds elements and coordinates updates with scene renderer
