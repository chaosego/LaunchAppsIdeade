Aplicacion web, basada en node para trabajo en local, con la siguiente misión:

- Comprobar de una lista de aplicaciones  y puertos dados, si la aplicacion esta corriendo comprobar el proceso y el puerto establecido para ver si el sistema esta activo de alguna manera, algunas son apps en next y otros son servidores en node o en sails.
- Debe mostrarlos en una web, el estado y opciones de reinicio de las aplicaciones.
- Deben de poder añadirse o modificarse las aplicaciones desde una lista de json, las aplicaciones estan en local.

Debes de preguntarme todo, frieme a preguntas para concretar todos los aspectos, deberiamos poder cargar la lista, poder ver los procesos/apicaciones, si estan activos y si responden al ping u otro método (puedo facilitar metodos de acceso para los servidores, para ver si responden o estan 'colgados'), ademas igual sería bueno poner que sean autolaunch, es decir, que al arrancar esta app (que estará con pm2 para que se lance automaticamente) se lancen las apps marcadas con autostart, tambien deberian de poder pausarse y que cada cierto tiempo (2-3 horas, o configurable) se compruebe si estan lanzadas y accesibles y en caso contrario, relanzarlas
Tambien deberia de llevar opciones cada app (en la lista) de parar, reiniciar, iniciar y el pausar del estado anterior.
A nivel de lista, debe de llevar las opciones, de actualizar todas, relanzar todas, parar todas, etc...

Repito, frieme a pregunas.