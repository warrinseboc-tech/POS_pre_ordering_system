const add = document.querySelectorAll('.add');

add.forEach(e => {
    e.addEventListener('click', ()=>{
        const p = e.previousElementSibling.lastElementChild;
        const itemadd = e.firstElementChild;
        const itemrmv = e.lastElementChild;

        e.classList.toggle('none');
        itemadd.classList.toggle('hide');
        itemrmv.classList.toggle('show');
        p.classList.toggle('show');
    })
})