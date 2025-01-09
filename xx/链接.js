menu.addItem((item: MenuItem) =>
    item
        .setIcon("name")
        .setTitle("Eagle Name")
        .onClick(async () => {
            try {
                const response = await fetch(`${img.src}/name`);
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                const imageName = await response.text();
                new Notice(`Image Name: ${imageName}`);
            } catch (error) {
                new Notice('Failed to fetch image name');
            }
        })
);