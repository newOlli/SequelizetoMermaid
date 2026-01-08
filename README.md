# Sequelize to Mermaid
This script is for turning your [Sequelize](https://sequelize.org/) models into a beautiful [mermaid](https://mermaid.js.org/) diagram to ease your work if your db schema pictures are outdated.

**How to use:**

The script expects you to have the Sequelize models in the following folder structure: *src/models/***[your model files]**

It also currently only supports database schemas designed with a "modular model structure". Meaning that you have each of your models in a separate file.

For example:

    src\
	    models\
		    users.js
		    book.js
		    stores.js
It also expects to be placed into the root of the project / the folder the src folder is in. You can easily change these in the script if you need or want to.

**Notice!**

This script has not been tested with every Sequelize version and may not work correctly in all environments. Feel free to report any issues or if you’re proactive, feel free to create a PR.
