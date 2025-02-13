menu.addItem((item: MenuItem) =>
    item
        .setIcon("link")
        .setTitle("To Eagle")
        .onClick(async () => {
            try {
                const match = img.src.match(/\/images\/(.*)\.info/);
                if (match && match[1]) {
                    const eagleLink = `eagle://item/${match[1]}`;
                    navigator.clipboard.writeText(eagleLink);
                    window.open(eagleLink, '_self'); // 直接运行跳转到 eagle:// 链接
                } else {
                    throw new Error('Invalid image source format');
                }
            }
            catch (error) {
                new Notice('Failed to Eagle');
            }
        })
);
menu.addItem(async (item: MenuItem) => {
    try {
        const response = await fetch(`${img.src}/name`);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const imageName = await response.text();
        item.setIcon("link")
            .setTitle(`Eagle Name: ${imageName}`)
            .onClick(() => {
                navigator.clipboard.writeText(imageName);
                new Notice(`Copied: ${imageName}`);
            });
    } catch (error) {
        item.setIcon("link").setTitle("Failed to fetch image name");
    }
});
menu.addItem(async (item: MenuItem) => {
    try {
        const response = await fetch(`${img.src}/annotation`);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const annotation = await response.text();
        item.setIcon("link")
            .setTitle(`Eagle Annotation: ${annotation}`)
            .onClick(() => {
                navigator.clipboard.writeText(annotation);
                new Notice(`Copied: ${annotation}`);
            });
    } catch (error) {
        item.setIcon("link").setTitle("Failed to fetch image annotation");
    }
});
menu.addItem(async (item: MenuItem) => {
    try {
        const response = await fetch(`${img.src}/tags`);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const tags = await response.text();
        item.setIcon("link")
            .setTitle(`Eagle tags: ${tags}`)
            .onClick(() => {
                navigator.clipboard.writeText(tags);
                new Notice(`Copied: ${tags}`);
            });
    } catch (error) {
        item.setIcon("link").setTitle("Failed to fetch image tags");
    }
});
menu.addItem(async (item: MenuItem) => {
    try {
        const response = await fetch(`${img.src}/url`);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const url = await response.text();
        item.setIcon("link")
            .setTitle(`Eagle URL: ${url}`)
            .onClick(() => {
                navigator.clipboard.writeText(url);
                new Notice(`Copied: ${url}`);
                window.open(url, '_self');
            });
    } catch (error) {
        item.setIcon("link").setTitle("Failed to fetch image url");
    }
});

// menu.addItem((item: MenuItem) =>
//  item
//      .setIcon("external-link")
//      .setTitle("Open in windows")
//      .onClick(async () => {
//          const match = img.src.match(/\/images\/(.*)\.info/);
//          if (match && match[1]) {
//              const requestOptions: RequestInit = {
//                  method: 'GET',
//                  redirect: 'follow' as RequestRedirect
//              };

//              try {
//                  const response = await fetch(`http://localhost:41595/api/item/info?id=${match[1]}`, requestOptions);
//                  const result = await response.json();

//                  if (result.status === "success" && result.data) {
//                      const { id, name, ext } = result.data;
//                      const infoToCopy = `ID: ${id}, Name: ${name}, Ext: ${ext}`;
//                      navigator.clipboard.writeText(infoToCopy);
//                      new Notice(`Copied: ${infoToCopy}`);
//                  } else {
//                      console.log('Failed to fetch item info');
//                  }
//              } catch (error) {
//                  console.log('Error fetching item info', error);
//              }
//          } else {
//              console.log('Invalid image source format');
//          }
//      })
// );
// menu.addItem((item: MenuItem) =>
//  item
//      .setIcon("name")
//      .setTitle("Eagle Name")
//      .onClick(async () => {
//          try {
//              const response = await fetch(`${img.src}/name`);
//              if (!response.ok) {
//                  throw new Error('Network response was not ok');
//              }
//              const imageName = await response.text();
//              new Notice(`Image Name: ${imageName}`);
//          } catch (error) {
//              new Notice('Failed to fetch image name');
//          }
//      })
// );
// menu.addItem((item: MenuItem) =>
//  item
//      .setIcon("name")
//      .setTitle("Eagle Name2[cs,Gh]")
// );
// menu.addItem((item: MenuItem) =>
//  item
//      .setIcon("external-link")
//      .setTitle("Open in external browser")
//      .onClick(async () => {
//          window.open(img.src, '_blank');
//      })
// );