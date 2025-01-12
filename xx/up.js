var data = {
    "path": "D:\\快速截图\\Graphein_2025-01-10_21-20-59.png",
    "name": "123",
    "website": "https://www.pixiv.net/artworks/83585181",
    "tags": ["FGO", "アルトリア・キャスター"],
};

var requestOptions = {
  method: 'POST',
  body: JSON.stringify(data),
  redirect: 'follow'
};

fetch("http://localhost:41595/api/item/addFromPath", requestOptions)
  .then(response => response.json())
  .then(result => console.log(result))
  .catch(error => console.log('error', error));